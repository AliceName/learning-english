using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace EnglishLearning.Api.Tests;

public sealed class IpaTranscriberTests
{
    private static readonly IpaTranscriber Transcriber = new();

    [Fact]
    public void Common_sentence_uses_bundled_dictionary_and_preserves_punctuation()
    {
        var result = Transcriber.Transcribe("Could you tell me how to get to the central library?");
        Assert.Equal("en-US", result.Accent);
        Assert.Empty(result.UnknownWords);
        Assert.Equal("/ˈkʊd ˈju ˈtɛɫ ˈmi ˈhaʊ ˈtu ˈɡɛt ˈtu ˈðə ˈsɛntɹəɫ ˈɫaɪbɹɛˌɹi?/", result.Ipa);
    }

    [Fact]
    public void Contractions_case_whitespace_and_productive_compounds_are_supported()
    {
        var result = Transcriber.Transcribe("  I’m   a well-known library-cat.  ");
        Assert.NotNull(result.Ipa);
        Assert.Empty(result.UnknownWords);
        Assert.DoesNotContain("  ", result.Ipa);
        Assert.DoesNotContain("library-cat", result.Ipa);
        Assert.Equal(Transcriber.Transcribe("I'm").Ipa, Transcriber.Transcribe("I’M").Ipa);
    }

    [Fact]
    public void Alternative_readings_are_explicit_instead_of_claiming_contextual_accuracy()
    {
        var result = Transcriber.Transcribe("I read a record.");
        var read = Assert.Single(result.Alternatives, item => item.Word == "read");
        Assert.Contains("/ˈɹɛd/", read.Pronunciations);
        Assert.Contains("/ˈɹid/", read.Pronunciations);
        Assert.NotNull(result.Ipa);
    }

    [Theory]
    [InlineData("Hello LinguaAI", "LinguaAI")]
    [InlineData("The meeting is at 25.", "25")]
    [InlineData("The meeting is at ٢٥.", "٢٥")]
    [InlineData("Hello tiếng Việt", "tiếng")]
    [InlineData("Hello 😊", "😊")]
    public void Unknown_words_numbers_foreign_text_and_symbols_never_become_fake_complete_ipa(string text, string unknown)
    {
        var result = Transcriber.Transcribe(text);
        Assert.Null(result.Ipa);
        Assert.Contains(unknown, result.UnknownWords);
    }

    [Fact]
    public void Input_bounds_and_punctuation_only_are_handled()
    {
        Assert.Throws<ArgumentException>(() => Transcriber.Transcribe(" "));
        Assert.Throws<ArgumentException>(() => Transcriber.Transcribe(new string('a', 1001)));
        Assert.Null(Transcriber.Transcribe("?!").Ipa);
        var longest = Transcriber.Transcribe(string.Join(' ', Enumerable.Repeat("w", 500)));
        Assert.NotNull(longest.Ipa);
        Assert.InRange(longest.Ipa.Length, 1, 8000);
    }
}

public sealed partial class RegistrationSqlServerTests
{
    [SqlServerFact]
    public async Task Ipa_endpoint_validates_input_and_rechecks_admin_permissions()
    {
        const string path = "/api/v1/admin/pronunciation/ipa";
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync(path, new {text="Hello world"})).StatusCode);
        var user = await SignIn(await RegisterLoginUser());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", user.AccessToken);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(path, new {text="Hello world"})).StatusCode);
        var admin = await AuthoringAdmin();
        foreach (var invalid in new[]{"", "   ", new string('a', 1001)})
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(path, new {text=invalid})).StatusCode);
        var response = await client.PostAsJsonAsync(path, new {text="Could you tell me the way?"});
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        Assert.NotNull((await response.Content.ReadFromJsonAsync<GenerateIpaResponse>())!.Ipa);
        var unknown = await client.PostAsJsonAsync(path, new {text="Hello LinguaAI"});
        Assert.Null((await unknown.Content.ReadFromJsonAsync<GenerateIpaResponse>())!.Ipa);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        await db.Users.Where(item => item.UserId == admin.User.UserId).ExecuteUpdateAsync(update => update.SetProperty(item => item.Role, UserRoles.User));
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(path, new {text="Hello world"})).StatusCode);
        await db.Users.Where(item => item.UserId == admin.User.UserId).ExecuteUpdateAsync(update => update.SetProperty(item => item.IsActive, false));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync(path, new {text="Hello world"})).StatusCode);
    }

    [SqlServerFact]
    public async Task Saving_speaking_generates_missing_ipa_preserves_manual_corrections_and_allows_unknown_drafts()
    {
        await AuthoringAdmin();
        var course = await NewAuthoringCourse();
        var lesson = course.Lessons.Single(item => item.SkillType == "speaking");
        var response = await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{lesson.LessonId}", new SaveLessonRequest
        {
            Title = "Automatic IPA", SkillType = "speaking", Speaking = new SpeakingContent {Sentences = [
                new SpeakingSentence {Text="Hello world!"},
                new SpeakingSentence {Text="Hello world!", Ipa="/həˈloʊ wɜrld/"},
                new SpeakingSentence {Text="Hello LinguaAI"}
            ]}
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var saved = (await client.GetFromJsonAsync<AdminCourseResponse>($"/api/v1/admin/courses/{course.CourseId}"))!
            .Lessons.Single(item => item.LessonId == lesson.LessonId).Speaking!.Sentences;
        Assert.Equal(new IpaTranscriber().Transcribe("Hello world!").Ipa, saved[0].Ipa);
        Assert.Equal("/həˈloʊ wɜrld/", saved[1].Ipa);
        Assert.Null(saved[2].Ipa);
    }
}
