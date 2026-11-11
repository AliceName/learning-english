using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace EnglishLearning.Api.Contracts;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SubmitWritingRequest
{
    [StringLength(100)] public string? TaskId { get; init; }
    [StringLength(64)] public string? TaskVersion { get; init; }
    [Range(1, int.MaxValue)] public int? ParentSubmissionId { get; init; }
    [StringLength(500)]
    public string? Topic { get; init; }

    [Required(ErrorMessage = "Vui lòng nhập bài viết.")]
    [StringLength(12000, MinimumLength = 1)]
    public string OriginalText { get; init; } = string.Empty;

    public bool Corrections { get; init; }
}

public sealed record WritingExplanation(string Category, string Original, string Suggestion,
    string Message, string TemplateVersion);
public sealed record WritingSuggestion(string Original, string Suggestion, WritingExplanation[]? Explanations = null,
    int? SourceStart = null, int? SourceEnd = null);
public sealed record WritingProvenance(string? CefrRun = null, string? CefrAdapterSha256 = null,
    string? GecRun = null, string? GecAdapterSha256 = null, string? ExplanationVersion = null,
    string? GuardVersion = null, string? InputPolicyVersion = null);
public sealed record WritingGecCoverage(
    [property: JsonRequired] int TotalBodySentences,
    [property: JsonRequired] int Changed,
    [property: JsonRequired] int Unchanged,
    [property: JsonRequired] int Rejected,
    [property: JsonRequired] int InputOverBudget,
    [property: JsonRequired] int Incomplete,
    [property: JsonRequired] int SentenceLimit);
public sealed record WritingFeedbackItem(string Criterion, string Quote, string Comment, string Action,
    int? SuggestionIndex = null);
public sealed record WritingFeedback(string Status, WritingFeedbackItem[] Items, string Message,
    string? ModelId = null, string? ModelSha256 = null, string? PromptVersion = null);
public sealed record WritingAnalysis(string Cefr, string? CorrectedText,
    WritingSuggestion[] Errors, string[] Warnings, WritingProvenance? Provenance = null,
    WritingFeedback? Feedback = null, WritingGecCoverage? GecCoverage = null,
    WritingTaskSnapshot? Task = null, WritingPractice? Practice = null);
public sealed record WritingSubmissionResponse(int SubmissionId, string? Topic, string OriginalText,
    string CefrLevel, string? CorrectedText, WritingSuggestion[] Errors, string[] Warnings, DateTime CreatedAt,
    WritingProvenance? Provenance = null, WritingFeedback? Feedback = null,
    WritingGecCoverage? GecCoverage = null, WritingTaskSnapshot? Task = null,
    int? PracticeRootId = null, int? ParentSubmissionId = null);

public sealed record WritingTaskSnapshot(string Id, string Version, string Title, string Prompt,
    string Level, string Genre, string Topic, int MinWords, int MaxWords, string WordMode,
    string[] Requirements, string SourceSha256, string SourcePromptSha256, string ReviewStatus);
public sealed record WritingTaskCatalogue(WritingTaskSnapshot[] Items, string Version, int SourceCount);
public sealed record WritingPractice(int? RootSubmissionId, int? ParentSubmissionId);
public sealed record WritingPracticeItem(int PracticeRootId, int LatestSubmissionId, int SubmissionCount,
    string? Topic, string CefrLevel, DateTime CreatedAt);
public sealed record WritingPractices(WritingPracticeItem[] Items, int? NextBeforeId);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class WritingPreflightRequest
{
    [Required(ErrorMessage = "Vui lòng nhập bài viết.")]
    [StringLength(12000, MinimumLength = 1)]
    public string OriginalText { get; init; } = string.Empty;
    public bool Corrections { get; init; }
}

public sealed record WritingCapabilities(
    [property: JsonRequired] string Status,
    [property: JsonRequired] bool CorrectionsEnabled,
    [property: JsonRequired] bool FeedbackEnabled,
    [property: JsonRequired] string FeedbackStatus,
    [property: JsonRequired] int? CefrLimit,
    [property: JsonRequired] int? GecInputLimit,
    [property: JsonRequired] int? GecSentenceLimit,
    [property: JsonRequired] bool Busy);
public sealed record WritingPreflightSentence(
    [property: JsonRequired] int Index, [property: JsonRequired] int Start,
    [property: JsonRequired] int End, [property: JsonRequired] int Tokens, [property: JsonRequired] string Status);
public sealed record WritingPreflight(
    [property: JsonRequired] int CefrTokens, [property: JsonRequired] int CefrLimit,
    [property: JsonRequired] bool CanAnalyze, [property: JsonRequired] bool CorrectionsEnabled,
    [property: JsonRequired] int? GecInputLimit, [property: JsonRequired] int GecSentenceLimit,
    [property: JsonRequired] WritingPreflightSentence[] Sentences,
    WritingInputAssessment? InputAssessment = null);
public sealed record WritingInputAssessment(string Status, string[] Reasons, string[] Warnings, string PolicyVersion);
public sealed record WritingHistoryItem(int SubmissionId, string? Topic, string CefrLevel,
    DateTime CreatedAt, string Preview);
public sealed record WritingHistory(WritingHistoryItem[] Items, int? NextBeforeId);
