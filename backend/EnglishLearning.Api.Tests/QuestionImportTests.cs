using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Xml.Linq;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace EnglishLearning.Api.Tests;

public sealed class QuestionImportTests
{
    private static readonly XNamespace Word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

    [Fact]
    public void Downloadable_word_template_imports_all_three_examples()
    {
        using var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "mau-nhap-cau-hoi.docx"));
        var preview = QuestionDocxImport.Read(file, default);
        Assert.Empty(preview.Warnings);
        Assert.Equal(3, preview.Questions.Length);
        Assert.All(preview.Questions, item => Assert.Equal("ready", item.Status));
        Assert.Equal(1, preview.Questions[0].Question!.CorrectOptionIndex);
        Assert.Equal("study", preview.Questions[1].Question!.Answer);
        Assert.Equal(1, preview.Questions[2].Question!.CorrectOptionIndex);
    }

    [Fact]
    public void Reads_inline_and_table_answers_in_source_order()
    {
        using var file = Docx(
            Paragraph("Câu 3. Which sentence is correct?"), Paragraph("A. She works."), Paragraph("B. She work."),
            Paragraph("Đáp án: A"), Paragraph("Giải thích: Chủ ngữ she đi với works."),
            Paragraph("Câu 6. They [blank] here."), Paragraph("Đáp án: study"),
            Paragraph("Question 8: Choose a preposition."), Paragraph("A. in"), Paragraph("B. on"),
            Paragraph("HẾT"), AnswerTable(["Câu", "8"], ["Chọn", "B"]));

        var preview = QuestionDocxImport.Read(file, default);

        Assert.Empty(preview.Warnings);
        Assert.Equal(new[] { 3, 6, 8 }, preview.Questions.Select(item => item.Source.QuestionNumber));
        Assert.All(preview.Questions, item => Assert.Equal("ready", item.Status));
        Assert.Equal(0, preview.Questions[0].Question!.CorrectOptionIndex);
        Assert.Equal("Chủ ngữ she đi với works.", preview.Questions[0].Question!.Explanation);
        Assert.Equal("study", preview.Questions[1].Question!.Answer);
        Assert.Equal(1, preview.Questions[2].Question!.CorrectOptionIndex);
        Assert.Equal("B", Assert.Single(preview.Questions[2].Source.TableAnswers));
    }

    [Fact]
    public void Does_not_guess_missing_conflicting_or_ambiguous_keys()
    {
        using var file = Docx(
            Paragraph("Câu 1. First?"), Paragraph("A. Alpha"), Paragraph("B. Beta"), Paragraph("Đáp án: A"),
            Paragraph("Câu 2. Second?"), Paragraph("A. Red"), Paragraph("B. Blue"),
            Paragraph("Câu 2. Repeated number?"), Paragraph("A. Yes"), Paragraph("B. No"),
            Paragraph("Câu 3. Where is the book?"), Paragraph("A. Here"), Paragraph("B. There"),
            Paragraph("Câu 4. Write about your family."),
            AnswerTable(["Câu", "1", "2"], ["Chọn", "B", "A"]));

        var preview = QuestionDocxImport.Read(file, default);
        Assert.All(preview.Questions[..4], item =>
        {
            Assert.Equal("review", item.Status);
            Assert.Null(item.Question!.CorrectOptionIndex);
            Assert.NotEmpty(item.Issues);
        });
        Assert.Equal("unsupported", preview.Questions[4].Status);
        Assert.Null(preview.Questions[4].Question);
    }

    [Fact]
    public void Invalid_package_and_malformed_answer_table_fail_safely()
    {
        using var invalid = new MemoryStream([1, 2, 3]);
        Assert.Equal(400, Assert.Throws<AuthoringException>(() => QuestionDocxImport.Read(invalid, default)).Status);
        using var file = Docx(
            Paragraph("Câu 1. Which option?"), Paragraph("A. One"), Paragraph("B. Two"), Paragraph("Đáp án: B"),
            AnswerTable(["Câu", "1"], ["Chọn"]));

        var preview = QuestionDocxImport.Read(file, default);
        Assert.Single(preview.Warnings);
        var item = Assert.Single(preview.Questions);
        Assert.Equal("review", item.Status);
        Assert.Null(item.Question!.CorrectOptionIndex);
    }

    [Fact]
    public async Task Multipart_preview_is_admin_only_bound_to_the_target_and_read_only()
    {
        var database = Guid.NewGuid().ToString();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder
            .UseEnvironment("Development")
            .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> {
                ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only"
            }))
            .ConfigureServices(services => {
                services.RemoveAll<EnglishLearningDbContext>();
                services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>()
                    .UseInMemoryDatabase(database).Options));
            }));
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var admin = new User { Email = "import-admin@example.com", FullName = "Admin", PasswordHash = "test", Role = UserRoles.Admin };
        var learner = new User { Email = "import-learner@example.com", FullName = "Learner", PasswordHash = "test", Role = UserRoles.User };
        var course = new Course { Title = "Test import", SourceType = "system", IsPublished = false };
        db.AddRange(admin, learner, course);
        await db.SaveChangesAsync();
        const string original = """{"version":1,"grammar":{"topic":"Original","questions":[]}}""";
        var lesson = new Lesson { CourseId = course.CourseId, Title = "Grammar", SkillType = "grammar", Content = original };
        db.Add(lesson);
        await db.SaveChangesAsync();

        var route = $"/api/v1/admin/courses/{course.CourseId}/question-import/preview";
        async Task<HttpResponseMessage> Preview(string skill = "grammar", int? lessonId = null)
        {
            using var file = Docx(Paragraph("Câu 1. They [blank] here."), Paragraph("Đáp án: study"));
            using var multipart = new MultipartFormDataContent {
                { new ByteArrayContent(file.ToArray()), "file", "question.docx" },
                { new StringContent(skill), "skillType" }
            };
            if (lessonId is int id) multipart.Add(new StringContent(id.ToString()), "lessonId");
            return await client.PostAsync(route, multipart);
        }
        void SignIn(User user) => client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
            factory.Services.GetRequiredService<JwtTokenService>().CreateToken(user).AccessToken);

        using var anonymous = await Preview();
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        SignIn(learner);
        using var forbidden = await Preview();
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        SignIn(admin);
        using var wrongSkill = await Preview("reading", lesson.LessonId);
        Assert.Equal(HttpStatusCode.NotFound, wrongSkill.StatusCode);
        using var success = await Preview("grammar", lesson.LessonId);
        Assert.Equal(HttpStatusCode.OK, success.StatusCode);
        Assert.True(success.Headers.CacheControl?.NoStore);
        var data = await success.Content.ReadFromJsonAsync<QuestionImportPreview>();
        Assert.Equal("study", Assert.Single(data!.Questions).Question!.Answer);
        Assert.Equal(original, await db.Lessons.AsNoTracking().Select(item => item.Content).SingleAsync());
    }

    private static XElement Paragraph(string value) => new(Word + "p", new XElement(Word + "r", new XElement(Word + "t", value)));
    private static XElement AnswerTable(params string[][] rows) => new(Word + "tbl", rows.Select(row =>
        new XElement(Word + "tr", row.Select(value => new XElement(Word + "tc", Paragraph(value))))));

    private static MemoryStream Docx(params XElement[] blocks)
    {
        var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            using (var writer = new StreamWriter(zip.CreateEntry("[Content_Types].xml").Open()))
                writer.Write("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>");
            using var document = zip.CreateEntry("word/document.xml").Open();
            new XDocument(new XElement(Word + "document", new XElement(Word + "body", blocks))).Save(document);
        }
        stream.Position = 0;
        return stream;
    }
}
