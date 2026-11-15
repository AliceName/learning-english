using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public sealed class GrammarPracticeAnswer
{
    [Range(0, 29)] public int QuestionId { get; init; }
    [Range(0, 3)] public int? OptionIndex { get; init; }
    [StringLength(500)] public string? Text { get; init; }
}

public sealed class GrammarSubmissionRequest
{
    [Required, StringLength(64, MinimumLength = 64)] public string ContentVersion { get; init; } = "";
    [Required, MaxLength(30)] public GrammarPracticeAnswer[] Answers { get; init; } = [];
    [Range(0, 86400)] public int TimeSpentSeconds { get; init; }
}

public sealed record GrammarPracticeQuestion(int QuestionId, string Type, string Prompt, string[] Options, string? Tag);
public sealed record GrammarResultSummary(int ResultId, decimal Score, int TotalQuestions,
    int CorrectAnswers, int? TimeSpentSeconds, DateTime SubmittedAt);
public sealed record GrammarLessonLink(int LessonId, string Title);
public sealed record GrammarPracticeResponse(int CourseId, string CourseTitle, int LessonId, string Title,
    string? DifficultyLevel, int? EstimatedMinutes, string ContentVersion, string Topic, string Rules,
    string CommonMistakes, GrammarPracticeQuestion[] Questions, GrammarResultSummary? LatestResult, GrammarLessonLink[] Lessons);
public sealed record GrammarQuestionReview(int QuestionId, bool Correct, string? SubmittedAnswer,
    string CorrectAnswer, int? CorrectOptionIndex, string? Correction, string? Explanation);
public sealed record GrammarResultResponse(GrammarResultSummary Result, GrammarQuestionReview[] Review);
public sealed record GrammarWrongAnswersDocument(int Version, string ContentVersion, GrammarQuestionReview[] Questions);
