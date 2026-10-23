using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Tests;

public sealed partial class RegistrationSqlServerTests
{
    [SqlServerFact]
    public async Task Writing_demo_topic_and_markdown_round_trip_without_schema_changes()
    {
        await AuthoringAdmin();
        var course=await NewReadingWritingCourse(["writing"]);
        var content=new WritingContent
        {
            TaskType="proposal",Topic="A formal business proposal",
            Prompt="Write a **formal proposal**.\n\n## Requirements\n- Explain the expected ROI.\n- Give a timeline.",
            Instructions="1. **Introduction:** State the purpose.\n2. Describe ==key benefits==.",
            MinWords=150,MaxWords=250,Rubric=[new WritingCriterion{Name="Task achievement",Weight=100}]
        };
        var response=await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{course.Lessons[0].LessonId}",WritingLesson(content));
        Assert.Equal(HttpStatusCode.OK,response.StatusCode);
        var saved=(await client.GetFromJsonAsync<AdminCourseResponse>($"/api/v1/admin/courses/{course.CourseId}"))!.Lessons[0].Writing!;
        Assert.Equal(content.Topic,saved.Topic);Assert.Equal("proposal",saved.TaskType);
        Assert.Equal(content.Prompt,saved.Prompt);Assert.Equal(content.Instructions,saved.Instructions);
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish",null)).StatusCode);
    }

    [SqlServerFact]
    public async Task Reading_demo_preserves_format_translation_and_short_answers_with_scoring_metadata()
    {
        await AuthoringAdmin();var course=await NewReadingWritingCourse(["reading"]);
        var content=new ReadingContent
        {
            PassageTitle="Quarterly trends",Category="Corporate Economics",
            Passage="## Market trends\n\nDigital transactions showed an **exponential surge**.\n\nConsumers preferred ==flexible subscriptions==.",
            Translation="## Xu hướng thị trường\n\nGiao dịch kỹ thuật số tăng nhanh.",
            Vocabulary=[new ReadingVocabulary{Word="exponential surge",Meaning="mức tăng đột biến"}],
            Questions=[new ReadingQuestion{Type="short_answer",Prompt="What did consumers prefer?",Answer="flexible subscriptions",
                AcceptedAnswers=["subscriptions"],CaseSensitive=false,Focus="inference",Points=2.5m,
                Explanation="This is stated in the last sentence.",Reference="Paragraph 2"}]
        };
        var response=await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{course.Lessons[0].LessonId}",ReadingLesson(content));
        Assert.Equal(HttpStatusCode.OK,response.StatusCode);
        var saved=(await client.GetFromJsonAsync<AdminCourseResponse>($"/api/v1/admin/courses/{course.CourseId}"))!.Lessons[0].Reading!;
        Assert.Equal(content.Category,saved.Category);Assert.Equal(content.Translation,saved.Translation);Assert.Equal(content.Passage,saved.Passage);
        var question=Assert.Single(saved.Questions);Assert.Equal("short_answer",question.Type);Assert.Equal("inference",question.Focus);
        Assert.Equal(2.5m,question.Points);Assert.Equal("subscriptions",Assert.Single(question.AcceptedAnswers));
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync($"/api/v1/admin/courses/{course.CourseId}/publish",null)).StatusCode);
        var publicJson=await (await client.GetAsync($"/api/v1/courses/{course.CourseId}")).Content.ReadAsStringAsync();
        Assert.DoesNotContain("acceptedAnswers",publicJson);Assert.DoesNotContain("translation",publicJson);
    }

    [SqlServerFact]
    public async Task Reading_demo_rejects_missing_short_answer_invalid_points_and_invalid_focus()
    {
        await AuthoringAdmin();var course=await NewReadingWritingCourse(["reading","writing"]);
        var path=$"/api/v1/admin/courses/{course.CourseId}/lessons/{course.Lessons[0].LessonId}";
        var invalid=new[]{
            new ReadingQuestion{Type="short_answer",Prompt="Why?",Answer=" "},
            new ReadingQuestion{Type="short_answer",Prompt="Why?",Answer="Yes",Points=0},
            new ReadingQuestion{Type="short_answer",Prompt="Why?",Answer="Yes",Points=10.1m},
            new ReadingQuestion{Type="short_answer",Prompt="Why?",Answer="Yes",Focus="unknown"},
            new ReadingQuestion{Type="short_answer",Prompt="Why?",Answer="Yes",AcceptedAnswers=[""]}
        };
        foreach(var question in invalid)
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,ReadingLesson(new ReadingContent{Questions=[question]}))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,ReadingLesson(new ReadingContent{Translation=new string('a',30001)}))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync($"/api/v1/admin/courses/{course.CourseId}/lessons/{course.Lessons[1].LessonId}",WritingLesson(new WritingContent{Topic=new string('a',256)}))).StatusCode);
    }
}

public sealed class ReadingWritingCompatibilityTests
{
    [Fact]
    public void Existing_version_one_documents_supply_defaults_for_new_demo_fields()
    {
        var options=new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var oldReading=JsonSerializer.Deserialize<LessonContentDocument>("""
            {"version":1,"reading":{"passageTitle":"Old lesson","passage":"Existing content","questions":[{"type":"fill_blank","prompt":"A [blank]","answer":"bus"}]}}
            """,options)!;
        Assert.Equal("",oldReading.Reading!.Category);Assert.Equal("",oldReading.Reading.Translation);
        Assert.Equal("scanning",oldReading.Reading.Questions[0].Focus);Assert.Equal(1m,oldReading.Reading.Questions[0].Points);
        var oldWriting=JsonSerializer.Deserialize<LessonContentDocument>("""
            {"version":1,"writing":{"taskType":"essay","prompt":"Existing prompt","minWords":150,"maxWords":300}}
            """,options)!;
        Assert.Equal("",oldWriting.Writing!.Topic);Assert.Equal("Existing prompt",oldWriting.Writing.Prompt);Assert.Equal(300,oldWriting.Writing.MaxWords);
    }
}
