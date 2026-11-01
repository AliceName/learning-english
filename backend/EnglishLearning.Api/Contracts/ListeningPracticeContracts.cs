using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public sealed class ListeningAnswer
{
    [Range(0, 29)] public int QuestionId { get; init; }
    [Range(0, 3)] public int? OptionIndex { get; init; }
    [StringLength(500)] public string? Text { get; init; }
    [Required, MaxLength(8)] public ListeningMatchAnswer[] Matches { get; init; } = [];
}

public sealed class ListeningMatchAnswer
{
    [Range(0, 7)] public int LeftIndex { get; init; }
    [Required, StringLength(1024)] public string RightId { get; init; } = "";
}

public sealed class ListeningSubmissionRequest
{
    [Required, StringLength(64, MinimumLength = 64)] public string ContentVersion { get; init; } = "";
    [Required, MaxLength(30)] public ListeningAnswer[] Answers { get; init; } = [];
    [Range(0, 86400)] public int TimeSpentSeconds { get; init; }
}

public sealed class ListeningPositionRequest
{
    [Range(typeof(decimal), "0", "86400")] public decimal PositionSeconds { get; init; }
}

public sealed class ListeningResultsQuery
{
    [Range(1, 10000)] public int Page { get; init; } = 1;
    [Range(1, 50)] public int PageSize { get; init; } = 10;
}

public sealed record ListeningMatchOption(string Id, string Text);
public sealed record ListeningPracticeQuestion(int QuestionId, string Type, string Prompt,
    string[] Options, string[] MatchingLeft, ListeningMatchOption[] MatchingRight, int? AtSeconds);
public sealed record ListeningResultSummary(int ResultId, decimal Score, int TotalQuestions,
    int CorrectAnswers, int? TimeSpentSeconds, DateTime SubmittedAt);
public sealed record ListeningCourseProgress(int CompletedLessons, int TotalLessons, decimal Percent);
public sealed record ListeningLessonLink(int LessonId, string Title, bool Completed);
public sealed record ListeningPracticeResponse(int CourseId, string CourseTitle, int LessonId, string Title,
    string? DifficultyLevel, int? EstimatedMinutes, string AudioUrl, string ContentVersion,
    bool HideTranscriptFirstListen, ListeningPracticeQuestion[] Questions, decimal PositionSeconds,
    int AttemptCount, ListeningResultSummary? LatestResult, ListeningCourseProgress Progress,
    ListeningLessonLink[] Lessons);
public sealed record ListeningStartResponse(decimal PositionSeconds);
public sealed record ListeningPositionResponse(bool Saved);
public sealed record ListeningTranscriptResponse(string Transcript);
public sealed record ListeningPairReview(string Left, string? SubmittedAnswer, string CorrectAnswer, bool Correct);
public sealed record ListeningQuestionReview(int QuestionId, string Type, string Prompt, bool Correct,
    string? SubmittedAnswer, string CorrectAnswer, string? Explanation, int? AtSeconds, ListeningPairReview[] Pairs);
public sealed record ListeningResultResponse(ListeningResultSummary Result, bool FullReview,
    ListeningQuestionReview[] Review, ListeningCourseProgress Progress);
public sealed record ListeningResultsResponse(ListeningResultSummary[] Items, int TotalCount,
    int Page, int PageSize, int TotalPages);
public sealed record ListeningWrongAnswersDocument(int Version, string ContentVersion, ListeningQuestionReview[] Questions);
