namespace EnglishLearning.Api.Entities;

public sealed class UploadedDocument
{
    public int DocumentId { get; set; }
    public int UserId { get; set; }
    public string OriginalFileName { get; set; } = string.Empty;
    public string FileUrl { get; set; } = string.Empty;
    public string FileType { get; set; } = string.Empty;
    public string? ExtractedText { get; set; }
    public string? Summary { get; set; }
    public int? GeneratedCourseId { get; set; }
    public string Status { get; set; } = "processing";
    public DateTime CreatedAt { get; set; }
    public DateTime? ProcessedAt { get; set; }
}
