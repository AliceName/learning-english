namespace EnglishLearning.Api.Contracts;

public sealed record RegisteredUser(
    int UserId,
    string Email,
    string FullName,
    string? TargetLevel,
    DateTime CreatedAt,
    string Role);

public sealed record RegistrationResponse(string Message, RegisteredUser User);

public sealed record CurrentUserResponse(int UserId, string Email, string FullName,
    string? TargetLevel, DateTime CreatedAt, int CurrentStreak, string? AvatarUrl, string Role);
