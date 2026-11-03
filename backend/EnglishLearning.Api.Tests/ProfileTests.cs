using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace EnglishLearning.Api.Tests;

public sealed class ProfileTests
{
    [Fact]
    public async Task Update_uses_authenticated_identity_validates_input_and_preserves_protected_fields()
    {
        var database = Guid.NewGuid().ToString();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseEnvironment("Development").ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
                new Dictionary<string, string?> { ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only" }))
            .ConfigureServices(services => {
                services.RemoveAll<EnglishLearningDbContext>();
                services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(database).Options));
            }));
        using var client = factory.CreateClient();
        User owner, other;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            owner = new User { FullName = "Owner", Email = "owner@example.com", PasswordHash = "unchanged", CreatedAt = new DateTime(2026, 1, 1), CurrentStreak = 5 };
            other = new User { FullName = "Other", Email = "other@example.com", PasswordHash = "other-password" };
            db.Users.AddRange(owner, other); await db.SaveChangesAsync();
        }
        var valid = new { fullName = "  Nguyễn Văn Đạt  ", targetLevel = "B2", avatarUrl = "/avatars/profile-blue.svg", userId = other.UserId, role = "admin", email = "changed@example.com", passwordHash = "changed", currentStreak = 999 };
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PutAsJsonAsync("/api/v1/auth/me", valid)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", factory.Services.GetRequiredService<JwtTokenService>().CreateToken(owner).AccessToken);
        foreach (var invalid in new[] {
            new { fullName = " ", targetLevel = "B2", avatarUrl = (string?)null },
            new { fullName = "Name", targetLevel = "C3", avatarUrl = (string?)null },
            new { fullName = "Name", targetLevel = "A1", avatarUrl = (string?)"https://example.com/avatar.svg" },
            new { fullName = new string('a', 151), targetLevel = "B1", avatarUrl = (string?)null },
            new { fullName = "Bad\nName", targetLevel = "B1", avatarUrl = (string?)null }
        }) Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/v1/auth/me", invalid)).StatusCode);
        var response = await client.PutAsJsonAsync("/api/v1/auth/me", valid);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        var profile = (await response.Content.ReadFromJsonAsync<CurrentUserResponse>())!;
        Assert.Equal(owner.UserId, profile.UserId); Assert.Equal("Nguyễn Văn Đạt", profile.FullName);
        Assert.Equal("B2", profile.TargetLevel); Assert.Equal("/avatars/profile-blue.svg", profile.AvatarUrl);
        Assert.Equal("user", profile.Role); Assert.Equal(owner.Email, profile.Email);
        Assert.Equal(profile.FullName, (await client.GetFromJsonAsync<CurrentUserResponse>("/api/v1/auth/me"))!.FullName);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            var stored = await db.Users.SingleAsync(u => u.UserId == owner.UserId);
            Assert.Equal("unchanged", stored.PasswordHash); Assert.Equal(5, stored.CurrentStreak);
            Assert.Equal(owner.CreatedAt, stored.CreatedAt); Assert.True(stored.UpdatedAt > stored.CreatedAt);
            Assert.Equal("Other", (await db.Users.SingleAsync(u => u.UserId == other.UserId)).FullName);
        }
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/api/v1/auth/me", new { fullName = "Owner", targetLevel = (string?)null, avatarUrl = (string?)null })).StatusCode);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            var stored = await db.Users.SingleAsync(u => u.UserId == owner.UserId);
            Assert.Null(stored.AvatarUrl); Assert.Null(stored.TargetLevel);
            stored.IsActive = false; await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PutAsJsonAsync("/api/v1/auth/me", valid)).StatusCode);
    }
}
