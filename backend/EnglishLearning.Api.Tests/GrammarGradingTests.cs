using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;

namespace EnglishLearning.Api.Tests;

public sealed class GrammarGradingTests
{
    private static GrammarContent Content(bool caseSensitive = false) => new()
    {
        Topic = "Present Perfect", Rules = "S + have/has + V3", Questions = [
            new() { Prompt = "I ___ here since 2021.", Options = ["lived", "have lived"], CorrectOptionIndex = 1 },
            new() { Type = "fill_blank", Prompt = "A [blank].", Answer = "Café", AcceptedAnswers = ["coffee shop"], CaseSensitive = caseSensitive },
            new() { Type = "error_correction", Prompt = "He have lived here.", Options = ["He", "have lived", "here"], CorrectOptionIndex = 1,
                Correction = "has lived", Explanation = "He uses has." }
        ]
    };
    private static Lesson Lesson(GrammarContent content) => new()
    {
        LessonId = 12, SkillType = "grammar",
        Content = JsonSerializer.Serialize(new LessonContentDocument(1, null, null, content), GrammarGradingService.JsonOptions)
    };
    private static GrammarSubmissionRequest Submission(Lesson lesson, string text = "  CAFE\u0301  ") => new()
    {
        ContentVersion = GrammarGradingService.ContentVersion(lesson), Answers = [
            new() { QuestionId = 0, OptionIndex = 1 }, new() { QuestionId = 1, Text = text }, new() { QuestionId = 2, OptionIndex = 1 }
        ]
    };

    [Fact]
    public void Public_questions_do_not_expose_answer_keys_or_explanations()
    {
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(GrammarGradingService.PublicQuestions(Content()), GrammarGradingService.JsonOptions));
        foreach (var question in json.RootElement.EnumerateArray())
            foreach (var field in new[] { "answer", "acceptedAnswers", "correctOptionIndex", "correction", "explanation", "caseSensitive" })
                Assert.False(question.TryGetProperty(field, out _));
    }

    [Fact]
    public void All_question_types_are_graded_and_error_correction_includes_the_fix()
    {
        var content = Content(); var lesson = Lesson(content);
        var review = GrammarGradingService.Grade(lesson, content, Submission(lesson));
        Assert.All(review, item => Assert.True(item.Correct));
        Assert.Equal("CAFÉ", review[1].SubmittedAnswer);
        Assert.Equal("has lived", review[2].Correction);
        Assert.Equal("He uses has.", review[2].Explanation);
    }

    [Theory]
    [InlineData("COFFEE SHOP", false, true)]
    [InlineData("café", true, false)]
    [InlineData("Café", true, true)]
    [InlineData("café!", false, false)]
    [InlineData("  ", false, false)]
    public void Fill_blank_respects_alternatives_case_and_punctuation(string text, bool sensitive, bool expected)
    {
        var content = Content(sensitive); var lesson = Lesson(content);
        Assert.Equal(expected, GrammarGradingService.Grade(lesson, content, Submission(lesson, text))[1].Correct);
    }

    [Fact]
    public void Skipped_questions_are_incorrect()
    {
        var content = Content(); var lesson = Lesson(content);
        var review = GrammarGradingService.Grade(lesson, content, new() { ContentVersion = GrammarGradingService.ContentVersion(lesson) });
        Assert.Equal(3, review.Length); Assert.All(review, item => { Assert.False(item.Correct); Assert.Null(item.SubmittedAnswer); });
    }

    [Fact]
    public void Duplicate_unknown_out_of_range_and_mixed_answers_are_rejected()
    {
        var content = Content(); var lesson = Lesson(content);
        GrammarPracticeAnswer[][] invalid = [
            [new() { QuestionId = 0 }, new() { QuestionId = 0 }], [new() { QuestionId = 9 }],
            [new() { QuestionId = -1 }], [new() { QuestionId = 0, OptionIndex = 3 }],
            [new() { QuestionId = 0, OptionIndex = -1 }], [new() { QuestionId = 0, Text = "have lived" }],
            [new() { QuestionId = 1, OptionIndex = 0 }], [new() { QuestionId = 2, Text = "has lived" }], [null!]
        ];
        foreach (var answers in invalid)
            Assert.Equal(400, Assert.Throws<GrammarPracticeException>(() => GrammarGradingService.Grade(lesson, content,
                new() { ContentVersion = GrammarGradingService.ContentVersion(lesson), Answers = answers })).Status);
    }

    [Fact]
    public void Changed_lesson_content_cannot_be_graded_using_an_old_draft()
    {
        var content = Content(); var lesson = Lesson(content); var request = Submission(lesson);
        lesson.Content += " ";
        Assert.Equal(409, Assert.Throws<GrammarPracticeException>(() => GrammarGradingService.Grade(lesson, content, request)).Status);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("broken-json")]
    [InlineData("{}")]
    [InlineData("{\"version\":2}")]
    [InlineData("{\"version\":1,\"grammar\":{\"questions\":null}}")]
    [InlineData("{\"version\":1,\"grammar\":{\"topic\":\"Tenses\",\"rules\":\"Rules\",\"questions\":[]}}")]
    public void Malformed_or_empty_content_is_reported_as_unavailable(string json)
    {
        Assert.Equal(409, Assert.Throws<GrammarPracticeException>(() => GrammarGradingService.ReadContent(new Lesson { Content = json })).Status);
    }
}
