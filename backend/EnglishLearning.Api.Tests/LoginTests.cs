using System.ComponentModel.DataAnnotations;
using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace EnglishLearning.Api.Tests;

internal static class TestJwt
{
    internal const string SigningKey = "test-only-signing-key-for-integration-tests-never-use-in-production";

    internal static string Create(string key = SigningKey, string audience = "EnglishLearning.Web",
        string issuer = "EnglishLearning.Api", bool expired = false, bool unsigned = false)
    {
        var token = new JwtSecurityToken(issuer, audience,
            [new Claim(JwtRegisteredClaimNames.Sub, "1")],
            notBefore: DateTime.UtcNow.AddMinutes(-10),
            expires: expired ? DateTime.UtcNow.AddMinutes(-5) : DateTime.UtcNow.AddMinutes(5),
            signingCredentials: unsigned ? null : new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

public sealed class LoginValidationTests
{
    [Theory]
    [InlineData("", "Password123")]
    [InlineData("wrong-email", "Password123")]
    [InlineData("learner@example.com", "")]
    public void Login_requires_valid_email_and_password(string email, string password)
    {
        var request = new LoginRequest { Email = email, Password = password };
        Assert.False(Validator.TryValidateObject(request, new ValidationContext(request), [], true));
    }
}

public sealed partial class RegistrationSqlServerTests
{
    private async Task<string> RegisterLoginUser()
    {
        var email = $"login-{Guid.NewGuid():N}@example.com";
        Assert.Equal(HttpStatusCode.Created,
            (await client.PostAsJsonAsync("/api/v1/auth/register", Payload(email))).StatusCode);
        return email;
    }

    private async Task<LoginResponse> SignIn(string email)
    {
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = "Learning@2026" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<LoginResponse>())!;
    }

    private async Task<HttpResponseMessage> GetMe(string token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/auth/me");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await client.SendAsync(request);
    }

    [SqlServerFact]
    public async Task Login_returns_a_valid_jwt_and_authorizes_the_current_user()
    {
        var email = await RegisterLoginUser();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = "  " + email.ToUpperInvariant() + "  ", password = "Learning@2026" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("password", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Learning@2026", body);
        var result = (await response.Content.ReadFromJsonAsync<LoginResponse>())!;
        Assert.Equal("Bearer", result.TokenType);
        Assert.Equal(1800, result.ExpiresIn);
        Assert.Equal(email, result.User.Email);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(result.AccessToken);
        Assert.Equal("HS256", jwt.Header.Alg);
        Assert.Equal("EnglishLearning.Api", jwt.Issuer);
        Assert.Contains("EnglishLearning.Web", jwt.Audiences);
        Assert.Equal(result.User.UserId.ToString(), jwt.Subject);
        Assert.InRange(jwt.ValidTo, DateTime.UtcNow.AddMinutes(29), DateTime.UtcNow.AddMinutes(31));
        var profile = await GetMe(result.AccessToken);
        Assert.Equal(HttpStatusCode.OK, profile.StatusCode);
        Assert.Equal(email, (await profile.Content.ReadFromJsonAsync<RegisteredUser>())!.Email);
    }

    [SqlServerFact]
    public async Task Unknown_wrong_password_and_disabled_users_have_the_same_login_failure()
    {
        var email = await RegisterLoginUser();
        async Task<string> Failure(string address, string password)
        {
            var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = address, password });
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            Assert.False(json.RootElement.TryGetProperty("accessToken", out _));
            return json.RootElement.GetProperty("detail").GetString()!;
        }
        var wrong = await Failure(email, "WrongPassword123");
        Assert.Equal(wrong, await Failure($"missing-{Guid.NewGuid():N}@example.com", "Learning@2026"));
        using var scope = factory.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var user = await context.Users.SingleAsync(item => item.Email == email);
        user.IsActive = false;
        await context.SaveChangesAsync();
        Assert.Equal(wrong, await Failure(email, "Learning@2026"));
    }

    [SqlServerFact]
    public async Task Current_user_rejects_missing_forged_expired_unsigned_and_wrong_issuer_or_audience_tokens()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        foreach (var token in new[] {
            TestJwt.Create(key: "a-different-signing-key-that-has-at-least-thirty-two-bytes"),
            TestJwt.Create(audience: "wrong-audience"),
            TestJwt.Create(issuer: "wrong-issuer"),
            TestJwt.Create(expired: true),
            TestJwt.Create(unsigned: true),
            "invalid.token.value"
        })
            Assert.Equal(HttpStatusCode.Unauthorized, (await GetMe(token)).StatusCode);
    }

    [SqlServerFact]
    public async Task Disabling_an_account_prevents_access_with_an_existing_jwt()
    {
        var email = await RegisterLoginUser();
        var session = await SignIn(email);
        Assert.Equal(HttpStatusCode.OK, (await GetMe(session.AccessToken)).StatusCode);
        using var scope = factory.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var user = await context.Users.SingleAsync(item => item.Email == email);
        user.IsActive = false;
        await context.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await GetMe(session.AccessToken)).StatusCode);
    }

    [SqlServerFact]
    public async Task Login_upgrades_old_password_hashes_without_changing_profile_timestamps()
    {
        var email = await RegisterLoginUser();
        using var scope = factory.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var user = await context.Users.SingleAsync(item => item.Email == email);
        user.PasswordHash = new PasswordHasher<User>(Options.Create(new PasswordHasherOptions { IterationCount = 1 }))
            .HashPassword(user, "Learning@2026");
        var oldHash = user.PasswordHash;
        var updatedAt = user.UpdatedAt;
        await context.SaveChangesAsync();
        await SignIn(email);
        await context.Entry(user).ReloadAsync();
        Assert.NotEqual(oldHash, user.PasswordHash);
        Assert.Equal(PasswordVerificationResult.Success,
            new PasswordHasher<User>().VerifyHashedPassword(user, user.PasswordHash, "Learning@2026"));
        Assert.Equal(updatedAt, user.UpdatedAt);
    }

    [SqlServerFact]
    public async Task Excessive_login_attempts_are_rate_limited()
    {
        var email = $"rate-limit-{Guid.NewGuid():N}@example.com";
        for (var attempt = 0; attempt < 30; attempt++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = "WrongPassword123" })).StatusCode);
        var limited = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = "WrongPassword123" });
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.NotNull(limited.Headers.RetryAfter);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/login",
            new { email = $"another-{Guid.NewGuid():N}@example.com", password = "WrongPassword123" })).StatusCode);
    }
}
