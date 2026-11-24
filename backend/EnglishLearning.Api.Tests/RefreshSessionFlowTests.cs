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

public sealed class RefreshSessionFlowTests
{
    [Fact]
    public async Task Refresh_and_logout_enforce_the_session_across_real_HTTP_without_SQL()
    {
        var database = Guid.NewGuid().ToString();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseEnvironment("Development")
                .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Jwt:SigningKey"] = TestJwt.SigningKey,
                    ["ConnectionStrings:DefaultConnection"] = "in-memory-test-only",
                    ["Cloudinary:Enabled"] = "false"
                }))
                .ConfigureServices(services =>
                {
                    services.RemoveAll<EnglishLearningDbContext>();
                    services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>()
                        .UseInMemoryDatabase(database).Options));
                }));
        using var client = factory.CreateClient();
        const string email = "refresh-fixture@example.invalid";
        const string password = "InMemory-Fixture-Only-2026!";
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            var user = new User { Email = email, FullName = "Session test", IsActive = true };
            user.PasswordHash = scope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>().HashPassword(user, password);
            db.Users.Add(user);
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password, useRefreshSession = true });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var first = (await login.Content.ReadFromJsonAsync<LoginResponse>())!;
        Assert.NotNull(first.RefreshToken);
        var refreshed = await client.PostAsJsonAsync("/api/v1/auth/refresh", new RefreshRequest(first.RefreshToken));
        Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
        Assert.True(refreshed.Headers.CacheControl?.NoStore);
        var second = (await refreshed.Content.ReadFromJsonAsync<LoginResponse>())!;
        Assert.NotNull(second.RefreshToken);
        Assert.NotEqual(first.RefreshToken, second.RefreshToken);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", second.AccessToken);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/auth/me")).StatusCode);

        var logout = await client.PostAsJsonAsync("/api/v1/auth/logout", new RefreshRequest(second.RefreshToken));
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", first.AccessToken);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/v1/auth/refresh", new RefreshRequest(second.RefreshToken))).StatusCode);
    }
}
