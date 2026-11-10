using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Entities;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed class RefreshSessionTests
{
    [Fact]
    public void Session_renews_across_a_two_hour_lesson_and_stops_at_the_absolute_deadline()
    {
        var clock = new SessionClock();
        var options = Options.Create(new JwtOptions { Issuer = "test", Audience = "test", SigningKey = new string('s', 32) });
        var sessions = new RefreshSessions(clock, options);
        var tokens = new JwtTokenService(options, clock);
        var user = new User { UserId = 42, Email = "test@example.com", FullName = "Test", Role = UserRoles.User };
        var grant = sessions.Create(user.UserId)!;
        var deadline = grant.ExpiresAt;
        var start = clock.Now;
        for (var minute = 25; minute < 120; minute += 25)
        {
            clock.Now = start.AddMinutes(minute);
            var previous = grant;
            grant = sessions.Rotate(previous.Token, user.UserId)!;
            Assert.NotEqual(previous.Token, grant.Token);
            Assert.Equal(deadline, grant.ExpiresAt);
        }

        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(tokens.CreateToken(user, grant).AccessToken);
        Assert.Equal(start.AddMinutes(130).UtcDateTime, jwt.ValidTo);
        clock.Now = start.AddHours(2);
        Assert.True(sessions.Touch(grant.SessionId));
        clock.Now = start.AddHours(4);
        Assert.True(sessions.Touch(grant.SessionId));
        clock.Now = start.AddHours(6);
        Assert.True(sessions.Touch(grant.SessionId));
        clock.Now = deadline.AddMinutes(-5);
        grant = sessions.Rotate(grant.Token, user.UserId)!;
        Assert.Equal(deadline, tokens.CreateToken(user, grant).ExpiresAt);
        clock.Now = deadline;
        Assert.False(sessions.Touch(grant.SessionId));
        Assert.Null(sessions.FindUser(grant.Token));
    }

    [Fact]
    public void Overlapping_refreshes_share_the_replacement_then_reuse_revokes_the_session()
    {
        var clock = new SessionClock();
        var sessions = new RefreshSessions(clock, Options.Create(new JwtOptions()));
        var original = sessions.Create(42)!;
        var replacement = sessions.Rotate(original.Token, 42)!;
        Assert.Equal(replacement.Token, sessions.Rotate(original.Token, 42)!.Token);
        Assert.Equal(replacement.Token, sessions.Rotate(replacement.Token, 42)!.Token);
        clock.Now = clock.Now.AddSeconds(21);
        Assert.Null(sessions.Rotate(original.Token, 42));
        Assert.False(sessions.Touch(original.SessionId));
        Assert.Null(sessions.Rotate(replacement.Token, 42));
    }

    [Fact]
    public void Two_hours_without_api_traffic_still_allows_the_final_submission_to_refresh()
    {
        var clock = new SessionClock();
        var sessions = new RefreshSessions(clock, Options.Create(new JwtOptions()));
        var original = sessions.Create(42)!;
        clock.Now = clock.Now.AddHours(2);
        var replacement = sessions.Rotate(original.Token, 42)!;
        clock.Now = clock.Now.AddHours(3);
        Assert.Null(sessions.FindUser(replacement.Token));
    }

    private sealed class SessionClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 11, 4, 8, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }
}

public sealed partial class RegistrationSqlServerTests
{
    [SqlServerFact]
    public async Task Auth_refresh_issues_working_access_and_logout_revokes_the_whole_session()
    {
        var email = await RegisterLoginUser();
        var loginResponse = await client.PostAsJsonAsync("/api/v1/auth/login", new
        {
            email, password = "Learning@2026", useRefreshSession = true
        });
        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);
        var login = (await loginResponse.Content.ReadFromJsonAsync<LoginResponse>())!;
        Assert.NotNull(login.RefreshToken);
        var refresh = await client.PostAsJsonAsync("/api/v1/auth/refresh", new RefreshRequest(login.RefreshToken));
        Assert.Equal(HttpStatusCode.OK, refresh.StatusCode);
        Assert.True(refresh.Headers.CacheControl?.NoStore);
        var renewed = (await refresh.Content.ReadFromJsonAsync<LoginResponse>())!;
        Assert.NotNull(renewed.RefreshToken);
        Assert.NotEqual(login.RefreshToken, renewed.RefreshToken);
        Assert.Equal(HttpStatusCode.OK, (await GetMe(renewed.AccessToken)).StatusCode);

        var logout = await client.PostAsJsonAsync("/api/v1/auth/logout", new RefreshRequest(renewed.RefreshToken));
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await GetMe(login.AccessToken)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await GetMe(renewed.AccessToken)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/v1/auth/refresh", new RefreshRequest(renewed.RefreshToken))).StatusCode);
    }
}
