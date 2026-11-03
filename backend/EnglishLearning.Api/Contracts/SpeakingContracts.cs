using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public sealed class SubmitSpeakingRequest
{
    [Range(1, int.MaxValue)] public int LessonId { get; init; }
    [Range(0, 29)] public int SentenceIndex { get; init; }
    [Range(0, 29)] public int? SegmentIndex { get; init; }
    [Required] public IFormFile File { get; init; } = null!;
}
public sealed record SpeakingPhoneResult(string SourcePhone, string Symbol, double Score, double StartSeconds, double EndSeconds, double? RawScore = null);
public sealed record SpeakingWordResult(int Index, string Text, string Status, double? Score, SpeakingPhoneResult[] Phones, string? Reason);
public sealed record SpeakingAssessment(string Status, string ModelVersion, double DurationSeconds, double OverallScore,
    double Coverage, int ReferenceTokenCount, SpeakingWordResult[] Words, string[] Warnings, string Feedback, SpeakingInterpretation? Interpretation = null);
public sealed record SpeakingInterpretation(string CalibrationVersion, string CalibrationMethod, double PracticeThreshold,
    double ReviewThreshold, bool ThresholdFitted, double MinimumCoverage, string FeedbackMode, string EvidenceScope);
public sealed record SpeakingLessonResponse(int LessonId, int CourseId, string Title, string CourseTitle, string Goals,
    SpeakingSentence[] Sentences, int MaxRecordingSeconds = 12, int MaxAudioBytes = 2 * 1024 * 1024,
    SpeakingSegment[][]? Segments = null, string? SegmentationVersion = null);
public sealed record SpeakingSegment(int Index, string Text, int StartWordIndex, int WordCount);
public sealed record SpeakingAttemptScope(string Kind, int SegmentIndex, int StartWordIndex, int WordCount,
    string SentenceText, string SegmentationVersion);
public sealed record SpeakingAttemptResponse(int AttemptId, int LessonId, int SentenceIndex, string ReferenceText,
    DateTime CreatedAt, string AudioUrl, SpeakingAssessment Assessment, SpeakingAttemptScope? Scope = null);
public sealed record StoredSpeakingResult(int Version, int SentenceIndex, string ReferenceText, SpeakingAssessment Assessment,
    SpeakingAttemptScope? Scope = null);
