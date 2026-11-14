using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Tests;

public sealed partial class RegistrationSqlServerTests
{
    [SqlServerFact]
    public async Task Profile_SQL_details_and_security_round_trip_inside_rolled_back_fixture_transaction()
    {
        var email = await RegisterLoginUser();
        var first = await SignIn(email);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", first.AccessToken);
        var response = await client.PutAsJsonAsync("/api/v1/auth/me", new
        {
            fullName = "SQL profile fixture", targetLevel = "C1", avatarUrl = "/avatars/mascot-bear-purple.svg",
            personalDetails = new { phoneNumber = "0912 345 678", dateOfBirth = "2000-02-29", address = "Fixture address" },
            learningPreferences = new { learningPurpose = "study", preferredSkill = "speaking", dailyGoalMinutes = 15 }
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var saved = (await response.Content.ReadFromJsonAsync<CurrentUserResponse>())!;
        Assert.Equal("0912345678", saved.PersonalDetails!.PhoneNumber);
        Assert.Equal(new DateOnly(2000, 2, 29), saved.PersonalDetails.DateOfBirth);
        var persisted = (await (await GetMe(first.AccessToken)).Content.ReadFromJsonAsync<CurrentUserResponse>())!;
        Assert.Equal(15, persisted.LearningPreferences!.DailyGoalMinutes);
        // A legacy access token without a refresh session also gets a new current-browser session.
        var revoke = await client.PostAsJsonAsync("/api/v1/auth/sessions/revoke-others", new { });
        Assert.Equal(HttpStatusCode.OK, revoke.StatusCode);
        var replacement = (await revoke.Content.ReadFromJsonAsync<LoginResponse>())!;
        Assert.Equal(HttpStatusCode.Unauthorized, (await GetMe(first.AccessToken)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", replacement.AccessToken);
        var changed = await client.PostAsJsonAsync("/api/v1/auth/change-password", new
        {
            currentPassword = "Learning@2026", newPassword = "SQL-Fixture-Only-2026!", confirmPassword = "SQL-Fixture-Only-2026!"
        });
        Assert.Equal(HttpStatusCode.NoContent, changed.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await GetMe(replacement.AccessToken)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/refresh", new RefreshRequest(replacement.RefreshToken!))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = "SQL-Fixture-Only-2026!" })).StatusCode);
    }
}
