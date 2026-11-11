using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace EnglishLearning.Api.Contracts;

public sealed record TranslationNextRequest(
    [Required, StringLength(10)] string Level, Guid RequestId, bool Review = false);

public sealed record TranslationGradeRequest(
    [Required, StringLength(1024)] string AttemptToken, [Required, StringLength(500)] string Answer,
    Guid RequestId, bool IncludeAiFeedback = false);

public sealed record TranslationPromptResponse(int PromptId, string Level, string Topic, string VietnameseText, string AttemptToken);
public sealed record TranslationGradeResponse(string Status, int? Score, bool MeaningCorrect, bool GrammarCorrect,
    string Feedback, string? CorrectedText, TranslationScores? Scores, TranslationIssue[] Issues, string[] Examples,
    string CandidateStatus, string? CorrectionExplanation = null, TranslationSuggestion? Alternative = null);
public sealed record TranslationScores(int Meaning, int Grammar, int Naturalness);
public sealed record TranslationIssue(string Original, string Suggestion, string Explanation);
public sealed record TranslationSuggestion(string Text, string Explanation);

public sealed record TranslationAiGrade(
    [property: JsonRequired] int Meaning, [property: JsonRequired] int Grammar, [property: JsonRequired] int Naturalness,
    [property: JsonRequired] bool MeaningCorrect, [property: JsonRequired] bool GrammarCorrect,
    [property: JsonRequired] bool MajorMeaningError, [property: JsonRequired] string Feedback,
    [property: JsonRequired] string CorrectedText, TranslationIssue[] Issues,
    string? CorrectionExplanation = null, TranslationSuggestion? Alternative = null);

public sealed record TranslationPromptDraft(string VietnameseText, string EnglishReference, string Level, string Topic, string[] MeaningNotes);
public sealed record TranslationDraftBatch(TranslationPromptDraft[] Prompts);
