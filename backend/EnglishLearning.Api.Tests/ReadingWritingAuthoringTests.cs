using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Tests;

public sealed partial class RegistrationSqlServerTests
{
    private static SaveLessonRequest WritingLesson(WritingContent? content=null)=>new()
    {
        Title="A formal request",SkillType="writing",DifficultyLevel="B2",EstimatedMinutes=30,
        Writing=content??new WritingContent
        {
            TaskType="email",Prompt="Write an email to your manager requesting a flexible schedule.",
            Instructions="Explain your reasons and suggest a schedule.",MinWords=120,MaxWords=200,
            SampleAnswer="Dear Ms Smith, I am writing to request a change to my work schedule.",
            Rubric=[new WritingCriterion{Name="Task achievement",Weight=40},new WritingCriterion{Name="Coherence",Weight=20},
                new WritingCriterion{Name="Vocabulary",Weight=20},new WritingCriterion{Name="Grammar",Weight=20}]
        }
    };
    private static SaveLessonRequest ReadingLesson(ReadingContent? content=null)=>new()
    {
        Title="Urban transport",SkillType="reading",DifficultyLevel="B1",EstimatedMinutes=25,
        Reading=content??new ReadingContent
        {
            PassageTitle="A greener city",Passage="A. In 2020, Riverton introduced electric buses.\n\nB. Residents now use public transport more often.",
            Instructions="Read the passage and answer the questions.",Vocabulary=[new ReadingVocabulary{Word="resident",Meaning="a person who lives in a place",Example="The residents use electric buses."}],
            Questions=[
                new ReadingQuestion{Prompt="What did Riverton introduce?",Options=["Trains","Electric buses"],CorrectOptionIndex=1,Explanation="See paragraph A.",Reference="Riverton introduced electric buses."},
                new ReadingQuestion{Type="fill_blank",Prompt="The city introduced [blank].",Answer="electric buses",AcceptedAnswers=["e-buses"]},
                new ReadingQuestion{Type="true_false_not_given",Prompt="The service is free.",Answer="not_given",Explanation="The price is not mentioned."},
                new ReadingQuestion{Type="matching",Prompt="Match paragraphs to topics.",Pairs=[new MatchingPair{Left="A",Right="New transport"},new MatchingPair{Left="B",Right="Travel habits"}]}
            ]
        }
    };
    private async Task<AdminCourseResponse> NewReadingWritingCourse(string[]? skills=null)
    {
        var response=await client.PostAsJsonAsync("/api/v1/admin/courses",new CreateCourseRequest
        {Title="Reading and Writing",Description="English reading and writing practice.",CoverImageUrl="https://example.com/cover.png",Skills=skills??["reading","writing"]});
        Assert.Equal(HttpStatusCode.Created,response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AdminCourseResponse>())!;
    }

    [SqlServerFact]
    public async Task All_five_authoring_types_can_be_initialized_without_schema_changes()
    {
        await AuthoringAdmin();
        var skills=new[]{"speaking","listening","reading","writing","grammar"};
        var course=await NewReadingWritingCourse(skills);
        Assert.Equal(skills,course.Lessons.Select(item=>item.SkillType));
        Assert.Contains("Reading",course.Lessons[2].Title);Assert.Contains("Writing",course.Lessons[3].Title);
        Assert.All(course.Lessons,item=>Assert.True(item.ContentSupported));
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/admin/courses",new {title="Bad",skills=new[]{"writting"}})).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/admin/courses",new {title="Bad",skills=new[]{"reading","reading"}})).StatusCode);
    }

    [SqlServerFact]
    public async Task Writing_round_trip_preserves_prompt_word_limits_rubric_sample_and_publishes()
    {
        await AuthoringAdmin();var course=await NewReadingWritingCourse(["writing"]);var lesson=Assert.Single(course.Lessons);
        var path=$"/api/v1/admin/courses/{course.CourseId}/lessons/{lesson.LessonId}";
        Assert.Equal(HttpStatusCode.OK,(await client.PutAsJsonAsync(path,WritingLesson())).StatusCode);
        var reloaded=(await client.GetFromJsonAsync<AdminCourseResponse>($"/api/v1/admin/courses/{course.CourseId}"))!;
        var saved=Assert.Single(reloaded.Lessons);Assert.True(saved.ContentSupported);Assert.Null(saved.Speaking);Assert.Null(saved.Reading);
        Assert.Equal("email",saved.Writing!.TaskType);Assert.Equal(120,saved.Writing.MinWords);Assert.Equal(200,saved.Writing.MaxWords);
        Assert.Equal(100,saved.Writing.Rubric.Sum(item=>item.Weight));Assert.Contains("Dear Ms Smith",saved.Writing.SampleAnswer);
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish",null)).StatusCode);
        var catalog=(await client.GetFromJsonAsync<CourseListResponse>("/api/v1/courses?skill=writing&level=B2"))!;
        Assert.Contains(catalog.Items,item=>item.CourseId==course.CourseId);
        Assert.Equal(HttpStatusCode.Conflict,(await client.PutAsJsonAsync(path,WritingLesson())).StatusCode);
    }

    [SqlServerFact]
    public async Task Reading_round_trip_preserves_four_question_types_and_vocab_and_does_not_leak_answers()
    {
        await AuthoringAdmin();var course=await NewReadingWritingCourse(["reading"]);var lesson=Assert.Single(course.Lessons);
        var path=$"/api/v1/admin/courses/{course.CourseId}/lessons/{lesson.LessonId}";
        Assert.Equal(HttpStatusCode.OK,(await client.PutAsJsonAsync(path,ReadingLesson())).StatusCode);
        var reloaded=(await client.GetFromJsonAsync<AdminCourseResponse>($"/api/v1/admin/courses/{course.CourseId}"))!;
        var saved=Assert.Single(reloaded.Lessons).Reading!;
        Assert.Contains("\n\nB.",saved.Passage);Assert.Equal("resident",Assert.Single(saved.Vocabulary).Word);
        Assert.Equal(new[]{"multiple_choice","fill_blank","true_false_not_given","matching"},saved.Questions.Select(item=>item.Type));
        Assert.Equal("not_given",saved.Questions[2].Answer);Assert.Equal("e-buses",Assert.Single(saved.Questions[1].AcceptedAnswers));
        Assert.Equal(2,saved.Questions[3].Pairs.Length);Assert.NotNull(saved.Questions[0].Reference);
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish",null)).StatusCode);
        var catalog=(await client.GetFromJsonAsync<CourseListResponse>("/api/v1/courses?skill=reading&level=B1"))!;
        Assert.Contains(catalog.Items,item=>item.CourseId==course.CourseId&&item.Skills.Contains("reading"));
        var publicDetail=await client.GetAsync($"/api/v1/courses/{course.CourseId}");
        Assert.Equal("reading",Assert.Single((await publicDetail.Content.ReadFromJsonAsync<CourseDetailResponse>())!.Lessons).SkillType);
        var json=await publicDetail.Content.ReadAsStringAsync();Assert.DoesNotContain("correctOptionIndex",json);Assert.DoesNotContain("acceptedAnswers",json);
    }

    [SqlServerFact]
    public async Task Writing_validation_rejects_bad_bounds_weights_and_mixed_content()
    {
        await AuthoringAdmin();var course=await NewReadingWritingCourse(["writing"]);
        var path=$"/api/v1/admin/courses/{course.CourseId}/lessons/{course.Lessons[0].LessonId}";
        var invalid=new[]{new WritingContent{MinWords=200,MaxWords=100},new WritingContent{MinWords=0},new WritingContent{MaxWords=5001},
            new WritingContent{TaskType="unknown"},new WritingContent{Rubric=[new WritingCriterion{Name="Grammar",Weight=30}]},
            new WritingContent{Rubric=[new WritingCriterion{Name="",Weight=100}]},new WritingContent{Rubric=[null!]}};
        foreach(var content in invalid)Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,WritingLesson(content))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,new SaveLessonRequest{Title="Mixed",SkillType="writing",Writing=new(),Reading=new()})).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,new SaveLessonRequest{Title="Missing",SkillType="writing"})).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,new SaveLessonRequest{Title="Audio",SkillType="writing",Writing=new(),AudioUrl="https://example.com/a.mp3"})).StatusCode);
    }

    [SqlServerFact]
    public async Task Reading_validation_rejects_bad_answers_unknown_types_and_null_collections()
    {
        await AuthoringAdmin();var course=await NewReadingWritingCourse(["reading"]);
        var path=$"/api/v1/admin/courses/{course.CourseId}/lessons/{course.Lessons[0].LessonId}";
        var invalid=new[]{new ReadingQuestion{Prompt="Pick",Options=["A","B"],CorrectOptionIndex=3},
            new ReadingQuestion{Type="fill_blank",Prompt="No marker",Answer="bus"},
            new ReadingQuestion{Type="fill_blank",Prompt="A [blank]",Answer="bus",AcceptedAnswers=[""]},
            new ReadingQuestion{Type="true_false_not_given",Prompt="Free?",Answer="maybe"},
            new ReadingQuestion{Type="matching",Prompt="Match",Pairs=[new MatchingPair{Left="A",Right="B"}]},
            new ReadingQuestion{Type="unknown",Prompt="Bad"}};
        foreach(var question in invalid)Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,ReadingLesson(new ReadingContent{Questions=[question]}))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,ReadingLesson(new ReadingContent{Questions=[null!]}))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,ReadingLesson(new ReadingContent{Vocabulary=[new ReadingVocabulary{Word="bus"}]}))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,ReadingLesson(new ReadingContent{Questions=null!}))).StatusCode);
    }

    [SqlServerFact]
    public async Task Incomplete_reading_writing_drafts_save_but_cannot_publish_until_complete()
    {
        await AuthoringAdmin();var course=await NewReadingWritingCourse();
        foreach(var lesson in course.Lessons)
        {
            var request=lesson.SkillType=="reading"?ReadingLesson(new ReadingContent()):WritingLesson(new WritingContent());
            Assert.Equal(HttpStatusCode.OK,(await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{lesson.LessonId}",request)).StatusCode);
        }
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish",null)).StatusCode);
        foreach(var lesson in course.Lessons)
        {
            var request=lesson.SkillType=="reading"?ReadingLesson():WritingLesson();
            Assert.Equal(HttpStatusCode.OK,(await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{lesson.LessonId}",request)).StatusCode);
        }
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish",null)).StatusCode);
    }

    [SqlServerFact]
    public async Task Reading_and_writing_can_be_added_with_admin_only_and_cross_course_writes_are_rejected()
    {
        await AuthoringAdmin();var course=await NewAuthoringCourse();var other=await NewReadingWritingCourse();
        foreach(var request in new[]{WritingLesson(),ReadingLesson()})Assert.Equal(HttpStatusCode.OK,(await client.PostAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons",request)).StatusCode);
        var saved=(await client.GetFromJsonAsync<AdminCourseResponse>($"/api/v1/admin/courses/{course.CourseId}"))!;
        Assert.Equal(new[]{"speaking","listening","writing","reading"},saved.Lessons.Select(item=>item.SkillType));
        Assert.Equal(HttpStatusCode.NotFound,(await client.PutAsJsonAsync($"/api/v1/admin/courses/{other.CourseId}/lessons/{saved.Lessons.Last().LessonId}",ReadingLesson())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{saved.Lessons[0].LessonId}",WritingLesson())).StatusCode);
        var regular=await SignIn(await RegisterLoginUser());client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",regular.AccessToken);
        foreach(var request in new[]{WritingLesson(),ReadingLesson()})Assert.Equal(HttpStatusCode.Forbidden,(await client.PostAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons",request)).StatusCode);
    }
}
