using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public sealed record ReadingPracticeQuestion(int QuestionId, string Type, string Prompt, string[] Options,
    string[] MatchingLeft, ListeningMatchOption[] MatchingRight, string Focus, decimal Points);
public sealed record CourseReadingLesson(int CourseId, string CourseTitle, int LessonId, string Title,
    string? DifficultyLevel, string ContentVersion, string PassageTitle, string Passage, string Instructions,
    ReadingVocabulary[] Vocabulary, ReadingPracticeQuestion[] Questions, string? Translation, GrammarResultSummary? LatestResult,
    string? ImageUrl = null, string ImageAlt = "", string ImageCaption = "", string Category = "", int? EstimatedMinutes = null);
public sealed record CourseReadingResult(GrammarResultSummary Result, ListeningQuestionReview[] Review, string Translation);
public sealed record CourseWritingLesson(int CourseId, string CourseTitle, int LessonId, string Title,
    string? DifficultyLevel, string ContentVersion, string TaskType, string Topic, string Prompt, string Instructions,
    int MinWords, int MaxWords, WritingCriterion[] Rubric, CourseWritingResult? LatestResult);
public sealed class CourseWritingRequest
{
    [Required, StringLength(64, MinimumLength = 64)] public string ContentVersion { get; init; } = "";
    [Required, StringLength(12000, MinimumLength = 1)] public string OriginalText { get; init; } = "";
    public bool Corrections { get; init; }
}
public sealed record CourseWritingResult(int SubmissionId, string OriginalText, string? CefrLevel,
    string? CorrectedText, WritingSuggestion[] Errors, string[] Warnings, WritingFeedback? Feedback,
    string SampleAnswer, DateTime CreatedAt);
