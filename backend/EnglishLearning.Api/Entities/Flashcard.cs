namespace EnglishLearning.Api.Entities;

public sealed class Flashcard
{
    public int CardId { get; set; }
    public int DeckId { get; set; }
    public string FrontText { get; set; } = string.Empty;
    public string BackText { get; set; } = string.Empty;
    public string? ExampleSentence { get; set; }
    public string? AudioUrl { get; set; }
    public string? ImageUrl { get; set; }
    public decimal EaseFactor { get; set; } = 2.50m;
    public int IntervalDays { get; set; }
    public int Repetition { get; set; }
    public DateTime? NextReviewAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
