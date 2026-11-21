using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace EnglishLearning.Api.Contracts;

public sealed record BookmarkResponse(string TargetType, int TargetId, DateTime CreatedAt, BookmarkTarget? Target, string? Note = null);

public sealed class BookmarkNoteRequest
{
    [JsonRequired, StringLength(500)]
    public string? Note { get; init; }
}

public sealed class BookmarkTarget
{
    public int Id { get; init; }
    public required string Title { get; init; }
    public int? ParentId { get; init; }
    public string? ParentTitle { get; init; }
    public string? SkillType { get; init; }
}
