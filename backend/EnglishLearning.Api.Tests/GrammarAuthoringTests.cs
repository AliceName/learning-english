using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.DependencyInjection;

namespace EnglishLearning.Api.Tests;

public sealed class GrammarModelTests
{
    [Fact]
    public void Only_lesson_skill_constraint_adds_grammar_without_changing_the_error_log_contract()
    {
        using var db=new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>()
            .UseSqlServer("Server=localhost;Database=ModelValidation;Integrated Security=True").Options);
        var model=db.GetService<IDesignTimeModel>().Model;
        var constraints=model.GetEntityTypes().SelectMany(entity=>entity.GetCheckConstraints()).ToArray();
        Assert.Contains("N'grammar'",constraints.Single(item=>item.Name=="CK_Lessons_SkillType").Sql);
        Assert.DoesNotContain("grammar",constraints.Single(item=>item.Name=="CK_ErrorLogs_SkillType").Sql);
    }
}

public sealed partial class RegistrationSqlServerTests
{
    private async Task EnableGrammarInTestTransaction()
    {
        // Exercise the real migration inside the fixture's rollback transaction. Never alter live schema permanently.
        using var scope=factory.Services.CreateScope();
        var db=scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var script=await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory,"003_add_grammar_lesson_type.sql"));
        await db.Database.ExecuteSqlRawAsync(script);
    }
    private static SaveLessonRequest GrammarLesson(GrammarContent? grammar=null) => new()
    {
        Title="Mixed Conditionals & Inversion",SkillType="grammar",DifficultyLevel="B2",EstimatedMinutes=35,
        Grammar=grammar??new GrammarContent
        {
            Topic="Third Conditional",Rules="`If + S + had + V3, S + would have + V3`\nIf I had known, I would have helped.",
            CommonMistakes="Use the base verb after did.",Questions=[
                new GrammarQuestion{Prompt="Hardly ___ arrived when it started raining.",Options=["had we","we had","did we","we did"],CorrectOptionIndex=0,Tag="Negative inversion",Explanation="Hardly + had + subject + V3 + when."},
                new GrammarQuestion{Type="fill_blank",Prompt="If I [blank], I would have helped.",Answer="had known",AcceptedAnswers=["'d known"],Explanation="Third conditional."},
                new GrammarQuestion{Type="error_correction",Prompt="Not only did he forgot his notes, but he also arrived late.",Options=["did he forgot","his notes","but he also","arrived late"],CorrectOptionIndex=0,Correction="did he forget",Explanation="Use the base verb after did."}
            ]
        }
    };
    private async Task<AdminCourseResponse> NewGrammarCourse()
    {
        var response=await client.PostAsJsonAsync("/api/v1/admin/courses",new CreateCourseRequest
        {Title="Grammar practice",Description="Practical English grammar.",CoverImageUrl="https://example.com/grammar.png",Skills=["grammar"],DifficultyLevel="B2"});
        Assert.Equal(HttpStatusCode.Created,response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AdminCourseResponse>())!;
    }

    [SqlServerFact]
    public async Task Grammar_migration_is_repeatable_and_keeps_only_five_lesson_types()
    {
        await EnableGrammarInTestTransaction();
        await EnableGrammarInTestTransaction();
        using var command=connection.CreateCommand();command.Transaction=transaction;
        command.CommandText="SELECT definition FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.Lessons') AND name=N'CK_Lessons_SkillType' AND is_disabled=0 AND is_not_trusted=0";
        var definition=Assert.IsType<string>(await command.ExecuteScalarAsync());
        foreach(var type in new[]{"speaking","writing","listening","reading","grammar"})Assert.Contains($"N'{type}'",definition);
        Assert.Equal(5,System.Text.RegularExpressions.Regex.Matches(definition,"N'[^']*'").Count);
    }

    [SqlServerFact]
    public async Task Grammar_draft_edit_reload_publish_and_catalog_filter_round_trip()
    {
        await EnableGrammarInTestTransaction();
        await AuthoringAdmin();var course=await NewGrammarCourse();
        var lesson=Assert.Single(course.Lessons);Assert.Equal("grammar",lesson.SkillType);
        Assert.Contains("Grammar",lesson.Title);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish",null)).StatusCode);
        var save=await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{lesson.LessonId}",GrammarLesson());
        Assert.Equal(HttpStatusCode.OK,save.StatusCode);
        var reloaded=(await client.GetFromJsonAsync<AdminCourseResponse>($"/api/v1/admin/courses/{course.CourseId}"))!;
        var saved=Assert.Single(reloaded.Lessons);Assert.True(saved.ContentSupported);Assert.Null(saved.Speaking);Assert.Null(saved.Listening);
        Assert.Equal(3,saved.Grammar!.Questions.Length);Assert.Equal("'d known",Assert.Single(saved.Grammar.Questions[1].AcceptedAnswers));
        Assert.Equal("did he forget",saved.Grammar.Questions[2].Correction);Assert.Contains("`If",saved.Grammar.Rules);
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync($"/api/v1/courses/{course.CourseId}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish",null)).StatusCode);
        var catalog=(await client.GetFromJsonAsync<CourseListResponse>("/api/v1/courses?skill=grammar&level=B2"))!;
        Assert.Contains(catalog.Items,item=>item.CourseId==course.CourseId&&item.Skills.Contains("grammar"));
        var publicDetail=await client.GetAsync($"/api/v1/courses/{course.CourseId}");
        var detail=(await publicDetail.Content.ReadFromJsonAsync<CourseDetailResponse>())!;
        Assert.Equal("grammar",Assert.Single(detail.Lessons).SkillType);Assert.Equal(35,detail.Course.EstimatedMinutes);
        Assert.DoesNotContain("correctOptionIndex",await publicDetail.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Conflict,(await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{lesson.LessonId}",GrammarLesson())).StatusCode);
    }

    [SqlServerFact]
    public async Task Grammar_validation_rejects_bad_answers_mixed_content_and_incomplete_publishing()
    {
        await EnableGrammarInTestTransaction();await AuthoringAdmin();var course=await NewGrammarCourse();
        var path=$"/api/v1/admin/courses/{course.CourseId}/lessons/{course.Lessons[0].LessonId}";
        var invalid=new[] {
            new GrammarQuestion{Prompt="Choose",Options=["A","B"],CorrectOptionIndex=3},
            new GrammarQuestion{Type="fill_blank",Prompt="Missing marker",Answer="had known"},
            new GrammarQuestion{Type="fill_blank",Prompt="If [blank]",Answer="yes",AcceptedAnswers=[""]},
            new GrammarQuestion{Type="error_correction",Prompt="He go.",Options=["He","go"],CorrectOptionIndex=1},
            new GrammarQuestion{Type="matching",Prompt="Unsupported"}
        };
        foreach(var question in invalid)Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,GrammarLesson(new GrammarContent{Questions=[question]}))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,new SaveLessonRequest{Title="Mixed",SkillType="grammar",Grammar=new(),Listening=new()})).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,new SaveLessonRequest{Title="Missing",SkillType="grammar"})).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await client.PutAsJsonAsync(path,GrammarLesson(new GrammarContent{Topic="Draft topic"}))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish",null)).StatusCode);
        var other=await NewGrammarCourse();
        Assert.Equal(HttpStatusCode.NotFound,(await client.PutAsJsonAsync($"/api/v1/admin/courses/{other.CourseId}/lessons/{course.Lessons[0].LessonId}",GrammarLesson())).StatusCode);
    }

    [SqlServerFact]
    public async Task Grammar_can_be_added_to_existing_courses_with_all_three_initial_types_supported()
    {
        await EnableGrammarInTestTransaction();await AuthoringAdmin();
        var course=await NewAuthoringCourse();
        var added=await client.PostAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons",GrammarLesson());
        Assert.Equal(HttpStatusCode.OK,added.StatusCode);
        Assert.Equal(new[]{"speaking","listening","grammar"},(await added.Content.ReadFromJsonAsync<AdminCourseResponse>())!.Lessons.Select(item=>item.SkillType));
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{course.Lessons[0].LessonId}",GrammarLesson())).StatusCode);
        var all=await client.PostAsJsonAsync("/api/v1/admin/courses",new CreateCourseRequest{Title="Three types",Skills=["speaking","listening","grammar"]});
        Assert.Equal(HttpStatusCode.Created,all.StatusCode);Assert.Equal(3,(await all.Content.ReadFromJsonAsync<AdminCourseResponse>())!.Lessons.Count);
        var regular=await SignIn(await RegisterLoginUser());client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",regular.AccessToken);
        Assert.Equal(HttpStatusCode.Forbidden,(await client.PostAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons",GrammarLesson())).StatusCode);
    }
}
