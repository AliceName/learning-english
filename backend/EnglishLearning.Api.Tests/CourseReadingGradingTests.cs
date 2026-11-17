using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.AiCourses;
using Microsoft.AspNetCore.DataProtection;

namespace EnglishLearning.Api.Tests;

public sealed class CourseReadingGradingTests
{
    private readonly CourseReadingGrading grading = new(new ListeningGradingService(new EphemeralDataProtectionProvider()));
    private static ReadingContent Content() => new() {
        Passage = "She studies at the library. It is open on Monday.",
        Questions = [
            new() { Type = "multiple_choice", Prompt = "Where?", Options = ["Park", "Library"], CorrectOptionIndex = 1 },
            new() { Type = "fill_blank", Prompt = "She [blank].", Answer = "studies", AcceptedAnswers = ["learns"] },
            new() { Type = "short_answer", Prompt = "Where does she study?", Answer = "library", AcceptedAnswers = ["the library"] },
            new() { Type = "true_false_not_given", Prompt = "She studies every day.", Answer = "not_given" },
            new() { Type = "matching", Prompt = "Match", Pairs = [new() { Left = "library", Right = "thư viện" }, new() { Left = "Monday", Right = "thứ Hai" }] }
        ]
    };
    private static Lesson Lesson(ReadingContent content, int id = 7) => new() { LessonId = id, SkillType = "reading", Content = JsonSerializer.Serialize(new LessonContentDocument(1, null, null, Reading: content), AiCourseStore.Json) };
    [Fact]
    public void All_system_reading_question_types_grade_without_exposing_answers_before_submission()
    {
        var content = Content(); var lesson = Lesson(content);
        var questions = grading.PublicQuestions(lesson, content);
        Assert.Equal(["True", "False", "Not Given"], questions[3].Options);
        Assert.Empty(questions[2].Options);
        var json = JsonSerializer.Serialize(questions, AiCourseStore.Json);
        Assert.DoesNotContain("correctOptionIndex", json);
        Assert.DoesNotContain("acceptedAnswers", json);
        var matching = questions[4].MatchingRight;
        var result = grading.Grade(lesson, content, new() {
            ContentVersion = ListeningGradingService.ContentVersion(lesson), Answers = [
                new() { QuestionId = 0, OptionIndex = 1 }, new() { QuestionId = 1, Text = " LEARNS " },
                new() { QuestionId = 2, Text = "the library" }, new() { QuestionId = 3, OptionIndex = 2 },
                new() { QuestionId = 4, Matches = [new() { LeftIndex = 0, RightId = matching.Single(item => item.Text == "thư viện").Id }, new() { LeftIndex = 1, RightId = matching.Single(item => item.Text == "thứ Hai").Id }] }
            ]
        });
        Assert.All(result, item => Assert.True(item.Correct));
        Assert.Equal("LEARNS", result[1].SubmittedAnswer);
        Assert.Equal("short_answer", result[2].Type);
        Assert.Equal("not_given", content.Questions[3].Answer);
    }
    [Fact]
    public void Mismatched_versions_duplicate_answers_and_foreign_matching_tokens_are_rejected()
    {
        var content = Content(); var lesson = Lesson(content); var version = ListeningGradingService.ContentVersion(lesson);
        Assert.Equal(409, Assert.Throws<CourseTextLessonException>(() => grading.Grade(lesson, content, new() { ContentVersion = new('0', 64) })).Status);
        Assert.Equal(400, Assert.Throws<ListeningPracticeException>(() => grading.Grade(lesson, content, new() { ContentVersion = version, Answers = [new() { QuestionId = 0 }, new() { QuestionId = 0 }] })).Status);
        var foreign = grading.PublicQuestions(Lesson(content, 8), content)[4].MatchingRight[0].Id;
        Assert.Equal(400, Assert.Throws<ListeningPracticeException>(() => grading.Grade(lesson, content, new() { ContentVersion = version, Answers = [new() { QuestionId = 4, Matches = [new() { LeftIndex = 0, RightId = foreign }] }] })).Status);
    }
}
