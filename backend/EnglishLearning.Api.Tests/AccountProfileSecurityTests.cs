using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace EnglishLearning.Api.Tests;

// All identities and password changes below exist only in this isolated in-memory database.
public sealed class AccountProfileSecurityTests : IAsyncLifetime
{
    private const string Email = "profile-fixture@example.invalid";
    private const string Password = "Fixture-Only-Password-2026!";
    private WebApplicationFactory<Program> factory = null!;
    private HttpClient client = null!;
    private User owner = null!;
    private User other = null!;

    public async Task InitializeAsync()
    {
        var database = Guid.NewGuid().ToString();
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Development")
            .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            { ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "in-memory-only", ["Cloudinary:Enabled"] = "false" }))
            .ConfigureServices(services =>
            {
                services.RemoveAll<EnglishLearningDbContext>();
                services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(database).Options));
            }));
        client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>();
        owner = new User { FullName = "Profile fixture", Email = Email, CreatedAt = new DateTime(2026, 1, 1), CurrentStreak = 4 };
        other = new User { FullName = "Other fixture", Email = "other-profile@example.invalid" };
        owner.PasswordHash = hasher.HashPassword(owner, Password); other.PasswordHash = hasher.HashPassword(other, Password);
        db.Users.AddRange(owner, other); await db.SaveChangesAsync();
    }
    public async Task DisposeAsync() { client.Dispose(); await factory.DisposeAsync(); }
    private async Task<LoginResponse> Login(string email = Email, string password = Password, bool refresh = true)
    {
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password, useRefreshSession = refresh });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<LoginResponse>())!;
    }
    private void Authorize(string token) => client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
    private async Task<HttpStatusCode> Status(string token)
    { Authorize(token); return (await client.GetAsync("/api/v1/auth/me")).StatusCode; }
    private async Task<HttpStatusCode> Refresh(string token) =>
        (await client.PostAsJsonAsync("/api/v1/auth/refresh", new RefreshRequest(token))).StatusCode;

    [Fact]
    public async Task Details_and_preferences_round_trip_clear_and_remain_private_and_backward_compatible()
    {
        Authorize((await Login()).AccessToken);
        var response = await client.PutAsJsonAsync("/api/v1/auth/me", new
        {
            fullName = "  Nguyễn Văn Đạt  ", targetLevel = "B2", avatarUrl = "/avatars/mascot-fox-teal.svg",
            personalDetails = new { phoneNumber = "+84 (912) 345-678", dateOfBirth = "2002-02-28", address = "  Đà Nẵng  " },
            learningPreferences = new { learningPurpose = "work", preferredSkill = "speaking", dailyGoalMinutes = 25 },
            userId = other.UserId, role = "admin", email = other.Email, authVersion = 99
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        var text = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("passwordHash", text); Assert.DoesNotContain("authVersion", text);
        var profile = (await response.Content.ReadFromJsonAsync<CurrentUserResponse>())!;
        Assert.Equal("Nguyễn Văn Đạt", profile.FullName); Assert.Equal(Email, profile.Email); Assert.Equal("user", profile.Role);
        Assert.Equal("+84912345678", profile.PersonalDetails!.PhoneNumber);
        Assert.Equal(new DateOnly(2002, 2, 28), profile.PersonalDetails.DateOfBirth); Assert.Equal("Đà Nẵng", profile.PersonalDetails.Address);
        Assert.Equal(25, profile.LearningPreferences!.DailyGoalMinutes);
        // Old clients update only original fields without erasing the new groups.
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/api/v1/auth/me", new { fullName = "Profile", targetLevel = "B1", avatarUrl = (string?)null })).StatusCode);
        var loaded = (await client.GetFromJsonAsync<CurrentUserResponse>("/api/v1/auth/me"))!;
        Assert.Equal(profile.PersonalDetails.PhoneNumber, loaded.PersonalDetails!.PhoneNumber);
        Assert.Equal("work", loaded.LearningPreferences!.LearningPurpose);
        Authorize((await Login(other.Email)).AccessToken);
        var otherProfile = (await client.GetFromJsonAsync<CurrentUserResponse>("/api/v1/auth/me"))!;
        Assert.Null(otherProfile.PersonalDetails!.PhoneNumber); Assert.Null(otherProfile.PersonalDetails.Address);
        Authorize((await Login()).AccessToken);
        var cleared = await client.PutAsJsonAsync("/api/v1/auth/me", new
        {
            fullName = "Profile", targetLevel = (string?)null, avatarUrl = (string?)null,
            personalDetails = new { phoneNumber = " ", dateOfBirth = (string?)null, address = "" },
            learningPreferences = new { learningPurpose = "", preferredSkill = "", dailyGoalMinutes = (int?)null }
        });
        Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);
        var result = (await cleared.Content.ReadFromJsonAsync<CurrentUserResponse>())!;
        Assert.Null(result.PersonalDetails!.PhoneNumber); Assert.Null(result.PersonalDetails.DateOfBirth); Assert.Null(result.PersonalDetails.Address);
        Assert.Null(result.LearningPreferences!.LearningPurpose); Assert.Null(result.LearningPreferences.DailyGoalMinutes);
    }

    [Fact]
    public async Task Invalid_optional_details_and_avatar_paths_are_rejected_without_partial_saves()
    {
        Authorize((await Login()).AccessToken);
        foreach (var details in new object[] {
            new { phoneNumber = "123", dateOfBirth = (string?)null, address = "OK" },
            new { phoneNumber = "12345678abc", dateOfBirth = (string?)null, address = "OK" },
            new { phoneNumber = "0912345678", dateOfBirth = "1899-12-31", address = "OK" },
            new { phoneNumber = "0912345678", dateOfBirth = "2999-01-01", address = "OK" },
            new { phoneNumber = "0912345678", dateOfBirth = "2023-02-29", address = "OK" },
            new { phoneNumber = "0912345678", dateOfBirth = "2002-01-01", address = new string('x', 501) },
            new { phoneNumber = "0912345678", dateOfBirth = "2002-01-01", address = "Bad\nAddress" }
        }) Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/v1/auth/me", new { fullName = "Must not save", targetLevel = "A1", avatarUrl = (string?)null, personalDetails = details })).StatusCode);
        foreach (var preferences in new object[] {
            new { learningPurpose = "unknown", preferredSkill = "speaking", dailyGoalMinutes = 15 },
            new { learningPurpose = "work", preferredSkill = "unknown", dailyGoalMinutes = 15 },
            new { learningPurpose = "work", preferredSkill = "speaking", dailyGoalMinutes = 4 },
            new { learningPurpose = "work", preferredSkill = "speaking", dailyGoalMinutes = 181 }
        }) Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/v1/auth/me", new { fullName = "Must not save", targetLevel = "A1", avatarUrl = (string?)null, learningPreferences = preferences })).StatusCode);
        foreach (var avatar in new[] { "/avatars/mascot-dog-blue.svg", "/avatars/mascot-cat-red.svg", "/avatars/mascot-cat-blue.svg?x=1", "/avatars/../mascot-cat-blue.svg", "https://example.invalid/picture.svg" })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/v1/auth/me", new { fullName = "Bad", targetLevel = "A1", avatarUrl = avatar })).StatusCode);
        Assert.Equal(owner.FullName, (await client.GetFromJsonAsync<CurrentUserResponse>("/api/v1/auth/me"))!.FullName);
    }

    [Fact]
    public async Task Revoke_others_replaces_current_browser_session_and_revokes_legacy_access_too()
    {
        var current = await Login(); var second = await Login(); var legacy = await Login(refresh: false); var unrelated = await Login(other.Email);
        Authorize(current.AccessToken);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/sessions/revoke-others", new { refreshToken = unrelated.RefreshToken })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, await Status(second.AccessToken));
        Authorize(current.AccessToken);
        var response = await client.PostAsJsonAsync("/api/v1/auth/sessions/revoke-others", new { refreshToken = current.RefreshToken });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.True(response.Headers.CacheControl?.NoStore);
        var replacement = (await response.Content.ReadFromJsonAsync<LoginResponse>())!;
        Assert.NotNull(replacement.RefreshToken); Assert.NotEqual(current.RefreshToken, replacement.RefreshToken);
        foreach (var token in new[] { current.AccessToken, second.AccessToken, legacy.AccessToken, TestJwt.Create() })
            Assert.Equal(HttpStatusCode.Unauthorized, await Status(token));
        Assert.Equal(HttpStatusCode.Unauthorized, await Refresh(second.RefreshToken!));
        Assert.Equal(HttpStatusCode.Unauthorized, await Refresh(current.RefreshToken!));
        Assert.Equal(HttpStatusCode.OK, await Status(replacement.AccessToken));
        Assert.Equal(HttpStatusCode.OK, await Refresh(replacement.RefreshToken!));
        Assert.Equal(HttpStatusCode.OK, await Status(unrelated.AccessToken));
        using var scope = factory.Services.CreateScope();
        var stored = await scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>().Users.SingleAsync(u => u.UserId == owner.UserId);
        Assert.Equal(1, stored.AuthVersion); Assert.Equal(owner.PasswordHash, stored.PasswordHash);
        // A delayed login carrying the previous hash/version cannot produce a usable refresh grant.
        var sessions = factory.Services.GetRequiredService<RefreshSessions>();
        var stale = sessions.Create(owner.UserId, 0)!;
        Assert.Equal(HttpStatusCode.Unauthorized, await Refresh(stale.Token));
    }

    [Fact]
    public async Task Password_change_requires_current_password_and_revokes_all_access_and_refresh_credentials()
    {
        var current = await Login(); var another = await Login(); var legacy = await Login(refresh: false);
        Authorize(current.AccessToken);
        foreach (var invalid in new[] {
            new { currentPassword = "Wrong-Password-123!", newPassword = "New-Fixture-Only-2026!", confirmPassword = "New-Fixture-Only-2026!" },
            new { currentPassword = Password, newPassword = "short", confirmPassword = "short" },
            new { currentPassword = Password, newPassword = Password, confirmPassword = Password },
            new { currentPassword = Password, newPassword = "New-Fixture-Only-2026!", confirmPassword = "Does-not-match" }
        }) Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/change-password", invalid)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, await Status(current.AccessToken));
        var changed = await client.PostAsJsonAsync("/api/v1/auth/change-password", new { currentPassword = Password, newPassword = "New-Fixture-Only-2026!", confirmPassword = "New-Fixture-Only-2026!" });
        Assert.Equal(HttpStatusCode.NoContent, changed.StatusCode);
        Assert.True(changed.Headers.CacheControl?.NoStore);
        foreach (var token in new[] { current.AccessToken, another.AccessToken, legacy.AccessToken, TestJwt.Create() })
            Assert.Equal(HttpStatusCode.Unauthorized, await Status(token));
        Assert.Equal(HttpStatusCode.Unauthorized, await Refresh(current.RefreshToken!));
        Assert.Equal(HttpStatusCode.Unauthorized, await Refresh(another.RefreshToken!));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = Email, password = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, await Status((await Login(password: "New-Fixture-Only-2026!")).AccessToken));
        using var scope = factory.Services.CreateScope();
        var stored = await scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>().Users.SingleAsync(u => u.UserId == owner.UserId);
        Assert.Equal(1, stored.AuthVersion); Assert.NotEqual(owner.PasswordHash, stored.PasswordHash);
        Assert.Equal(4, stored.CurrentStreak); Assert.Equal(owner.CreatedAt, stored.CreatedAt); Assert.Equal("user", stored.Role);
    }
}
