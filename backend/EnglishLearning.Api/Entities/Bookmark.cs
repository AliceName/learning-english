namespace EnglishLearning.Api.Entities;

public sealed class Bookmark
{
    public int BookmarkId { get; set; }
    public int UserId { get; set; }
    public string TargetType { get; set; } = string.Empty;
    public int TargetId { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
}
