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
    string? TargetLevel, DateTime CreatedAt, int CurrentStreak, string? AvatarUrl, string Role,
    PersonalDetails? PersonalDetails = null, LearningPreferences? LearningPreferences = null)
{
    public static CurrentUserResponse From(Entities.User user) => new(user.UserId, user.Email, user.FullName,
        user.TargetLevel, user.CreatedAt, user.CurrentStreak, user.AvatarUrl, user.Role,
        new PersonalDetails { PhoneNumber = user.PhoneNumber, DateOfBirth = user.DateOfBirth, Address = user.Address },
        new LearningPreferences { LearningPurpose = user.LearningPurpose, PreferredSkill = user.PreferredSkill, DailyGoalMinutes = user.DailyGoalMinutes });
}
