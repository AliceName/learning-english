using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.DataProtection;

namespace EnglishLearning.Api.Tests;

public sealed class ListeningGradingTests
{
    private readonly ListeningGradingService grading = new(new EphemeralDataProtectionProvider());
    private static ListeningContent Content(bool caseSensitive = false) => new()
    {
        Transcript = "[00:00] The meeting is on Thursday.",
        Questions = [
            new() { Prompt = "When is the meeting?", Options = ["Monday", "Thursday"], CorrectOptionIndex = 1 },
            new() { Type = "fill_blank", Prompt = "On [blank].", Answer = "Café", CaseSensitive = caseSensitive },
            new() { Type = "matching", Prompt = "Match", Pairs = [new() { Left = "meeting", Right = "cuộc họp" }, new() { Left = "Thursday", Right = "thứ Năm" }] }
        ]
    };
    private static Lesson Lesson(ListeningContent content) => new()
    {
        LessonId = 12, SkillType = "listening", AudioUrl = "/api/media/" + new string('a', 32) + ".wav",
        Content = JsonSerializer.Serialize(new LessonContentDocument(1, null, content), ListeningGradingService.JsonOptions)
    };
    private ListeningSubmissionRequest Submission(Lesson lesson, ListeningContent content, string text = "  CAFE\u0301  ")
    {
        var options = grading.PublicQuestions(lesson, content)[2].MatchingRight;
        return new() { ContentVersion = ListeningGradingService.ContentVersion(lesson), Answers = [
            new() { QuestionId = 0, OptionIndex = 1 }, new() { QuestionId = 1, Text = text },
            new() { QuestionId = 2, Matches = [new() { LeftIndex = 0, RightId = options.Single(option => option.Text == "cuộc họp").Id },
                new() { LeftIndex = 1, RightId = options.Single(option => option.Text == "thứ Năm").Id }] }
        ] };
    }

    [Fact]
    public void Public_payload_omits_answers_transcript_explanations_and_pair_alignment()
    {
        var content = Content(); var lesson = Lesson(content);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(grading.PublicQuestions(lesson, content), ListeningGradingService.JsonOptions));
        foreach (var item in json.RootElement.EnumerateArray())
        {
            foreach (var name in new[] { "answer", "correctOptionIndex", "caseSensitive", "explanation", "transcript", "pairs" })
                Assert.False(item.TryGetProperty(name, out _));
        }
        var first = grading.PublicQuestions(lesson, content)[2];
        var second = grading.PublicQuestions(lesson, content)[2];
        Assert.Equal(2, first.MatchingLeft.Length);
        Assert.Equal(2, first.MatchingRight.Length);
        Assert.All(first.MatchingRight, option => { Assert.DoesNotContain(":", option.Id); Assert.DoesNotContain(option.Id, second.MatchingRight.Select(item => item.Id)); });
    }

    [Fact]
    public void All_three_types_are_graded_on_server_with_unicode_normalization()
    {
        var content = Content(); var lesson = Lesson(content);
        var review = grading.Grade(lesson, content, Submission(lesson, content));
        Assert.All(review, item => Assert.True(item.Correct));
        Assert.Equal("CAFÉ", review[1].SubmittedAnswer);
        Assert.Equal(2, review[2].Pairs.Length);
    }

    [Theory]
    [InlineData("café", true, false)]
    [InlineData("Café", true, true)]
    [InlineData("café!", false, false)]
    [InlineData("   ", false, false)]
    public void Fill_blank_respects_case_punctuation_and_empty_answers(string text, bool sensitive, bool expected)
    {
        var content = Content(sensitive); var lesson = Lesson(content);
        Assert.Equal(expected, grading.Grade(lesson, content, Submission(lesson, content, text))[1].Correct);
    }

    [Fact]
    public void Blank_submission_is_valid_and_every_question_is_incorrect()
    {
        var content = Content(); var lesson = Lesson(content);
        var review = grading.Grade(lesson, content, new() { ContentVersion = ListeningGradingService.ContentVersion(lesson) });
        Assert.Equal(3, review.Length); Assert.All(review, item => Assert.False(item.Correct));
    }

    [Fact]
    public void One_wrong_matching_pair_makes_the_group_incorrect()
    {
        var content = Content(); var lesson = Lesson(content); var submission = Submission(lesson, content);
        var token = submission.Answers[2].Matches[0].RightId;
        var review = grading.Grade(lesson, content, new() { ContentVersion = submission.ContentVersion, Answers = [
            new() { QuestionId = 2, Matches = [new() { LeftIndex = 0, RightId = token }, new() { LeftIndex = 1, RightId = token }] }
        ] });
        Assert.False(review[2].Correct); Assert.True(review[2].Pairs[0].Correct); Assert.False(review[2].Pairs[1].Correct);
    }

    [Fact]
    public void Forged_cross_lesson_and_cross_question_matching_tokens_are_rejected()
    {
        var content = Content(); var lesson = Lesson(content); var token = Submission(lesson, content).Answers[2].Matches[0].RightId;
        foreach (var candidate in new[] { "forged", token })
        {
            var other = Lesson(content); other.LessonId = 13;
            var error = Assert.Throws<ListeningPracticeException>(() => grading.Grade(other, content, new()
            { ContentVersion = ListeningGradingService.ContentVersion(other), Answers = [new() { QuestionId = 2, Matches = [new() { LeftIndex = 0, RightId = candidate }] }] }));
            Assert.Equal(400, error.Status);
        }
    }

    [Fact]
    public void Duplicate_unknown_out_of_range_and_mixed_type_answers_are_rejected()
    {
        var content = Content(); var lesson = Lesson(content);
        ListeningAnswer[][] invalid = [
            [new() { QuestionId = 0, OptionIndex = 0 }, new() { QuestionId = 0, OptionIndex = 1 }],
            [new() { QuestionId = 9 }], [new() { QuestionId = 0, OptionIndex = 3 }],
            [new() { QuestionId = 0, OptionIndex = -1 }], [new() { QuestionId = 1, OptionIndex = 0 }],
            [new() { QuestionId = 0, Text = "answer" }],
            [new() { QuestionId = 2, Matches = [new() { LeftIndex = 0, RightId = "x" }, new() { LeftIndex = 0, RightId = "x" }] }]
        ];
        foreach (var answers in invalid) Assert.Equal(400, Assert.Throws<ListeningPracticeException>(() => grading.Grade(lesson, content,
            new() { ContentVersion = ListeningGradingService.ContentVersion(lesson), Answers = answers })).Status);
    }

    [Fact]
    public void Changed_content_is_rejected_instead_of_grading_against_a_different_exercise()
    {
        var content = Content(); var lesson = Lesson(content); var request = Submission(lesson, content);
        lesson.AudioUrl = "https://example.com/new.wav";
        Assert.Equal(409, Assert.Throws<ListeningPracticeException>(() => grading.Grade(lesson, content, request)).Status);
    }

    [Fact]
    public void Unsupported_or_incomplete_content_does_not_become_an_empty_exercise()
    {
        var content = Content(); var lesson = Lesson(content);
        Assert.NotNull(ListeningGradingService.ReadContent(lesson));
        foreach (var text in new[] { "broken-json", "null", "{}", "{\"version\":2}", "{\"version\":1,\"listening\":{\"questions\":null}}" })
        {
            lesson.Content = text;
            Assert.Equal(409, Assert.Throws<ListeningPracticeException>(() => ListeningGradingService.ReadContent(lesson)).Status);
        }
    }
}
