using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public sealed class AdminUserQuery
{
    [StringLength(200)] public string? Search { get; init; }
    [RegularExpression("^(admin|user)$")] public string? Role { get; init; }
    [RegularExpression("^(active|locked)$")] public string? Status { get; init; }
    [RegularExpression("^(newest|oldest|recent_study|name)$")] public string? Sort { get; init; }
    [Range(1, 10000)] public int Page { get; init; } = 1;
}

/// <summary>An admin action on an account; the reason is required and kept in the audit log.</summary>
public sealed class AdminUserActionRequest
{
    [Required, StringLength(500, MinimumLength = 5)] public string Reason { get; init; } = string.Empty;
}

public sealed class AdminUserRoleRequest
{
    [Required, RegularExpression("^(admin|user)$")] public string Role { get; init; } = string.Empty;
    [Required, StringLength(500, MinimumLength = 5)] public string Reason { get; init; } = string.Empty;
}

public sealed record AdminUserListItem(int UserId, string FullName, string Email, string Role, bool IsActive,
    DateTime CreatedAt, DateOnly? LastStudyDate, int CurrentStreak);
public sealed record AdminUserListResponse(IReadOnlyList<AdminUserListItem> Items, int TotalCount, int Page, int PageSize, int TotalPages);

/// <summary>Counts only: an admin sees how much a learner uses LEWA, never what they wrote or said.</summary>
public sealed record AdminUserStats(int StudyDaysThisYear, int WritingSubmissions, int FlashcardDecks, int Flashcards,
    int EnrolledCourses, int? AiCallsLast30Days);
public sealed record AdminAuditEntry(DateTimeOffset At, int ActorId, string? ActorName, int TargetId, string Action,
    string? From, string? To, string Reason);
public sealed record AdminUserDetail(int UserId, string FullName, string Email, string Role, bool IsActive, string? TargetLevel,
    DateTime CreatedAt, DateTime UpdatedAt, DateOnly? LastStudyDate, int CurrentStreak, int LongestStreak,
    AdminUserStats Stats, IReadOnlyList<AdminAuditEntry> History, bool IsSelf);
