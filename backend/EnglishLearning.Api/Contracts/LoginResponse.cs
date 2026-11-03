using System.Text.Json.Serialization;

namespace EnglishLearning.Api.Contracts;

public sealed record LoginResponse(
    string AccessToken,
    string TokenType,
    int ExpiresIn,
    DateTimeOffset ExpiresAt,
    RegisteredUser User,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? RefreshToken = null);
