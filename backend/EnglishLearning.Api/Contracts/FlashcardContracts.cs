using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public sealed class SaveDeckRequest
{
    private string title = "";
    [Required(ErrorMessage = "Nhập tên bộ thẻ."), StringLength(255)]
    public string Title { get => title; init => title = value?.Trim() ?? ""; }
    [StringLength(500)] public string? Description { get; init; }
}
public class SaveCardRequest
{
    private string front = "", back = "";
    [Required(ErrorMessage = "Nhập từ hoặc mặt trước."), StringLength(500)]
    public string FrontText { get => front; init => front = value?.Trim() ?? ""; }
    [Required(ErrorMessage = "Nhập nghĩa hoặc mặt sau."), StringLength(1000)]
    public string BackText { get => back; init => back = value?.Trim() ?? ""; }
    [StringLength(1000)] public string? ExampleSentence { get; init; }
}
public sealed class SaveWritingCardRequest : SaveCardRequest
{
    [Required, StringLength(100)] public string SourceTerm { get; init; } = "";
}

public sealed record WritingCardCandidate(string Term, string Context, string Source, string Reason, int? SimilarCardId = null);
public sealed record WritingCardSuggestions(int SubmissionId, int PracticeRootId, int? VersionNumber, string? TargetCefr,
    WritingCardCandidate[] Items);
// The source validated for this import request. Durable history requires an approved relation.
public sealed record WritingCardImportSource(int SubmissionId, int? VersionNumber, string Term, string Context);
public sealed record WritingCardSave(FlashcardResponse Card, bool AlreadySaved, WritingCardImportSource? ValidatedSource = null);
public sealed class ReviewCardRequest
{
    [Required, Range(0, 3)] public int? Rating { get; init; }
    [Required] public DateTime? ExpectedUpdatedAt { get; init; }
}
public sealed record DeckSummary(int DeckId, string Title, string? Description, int CardCount, int DueCount, bool CanEdit = true, bool IsAdminDeck = false);
public sealed record FlashcardResponse(int CardId, int DeckId, string FrontText, string BackText, string? ExampleSentence,
    int IntervalDays, int Repetition, DateTime? NextReviewAt, DateTime UpdatedAt, bool IsDue);
public sealed record DeckDetail(DeckSummary Deck, FlashcardResponse[] Cards);
