using System.Text.Json.Serialization;
using EnglishLearning.Api.Authentication;

namespace EnglishLearning.Api.Entities;

public sealed class User
{
    public int UserId { get; set; }
    public string Email { get; set; } = string.Empty;
    [JsonIgnore]
    public string PasswordHash { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string Role { get; set; } = UserRoles.User;
    public string? AvatarUrl { get; set; }
    public string? TargetLevel { get; set; }
    public int CurrentStreak { get; set; }
    public int LongestStreak { get; set; }
    public DateOnly? LastStudyDate { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
