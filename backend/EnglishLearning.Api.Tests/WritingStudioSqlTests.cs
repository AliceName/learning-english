using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace EnglishLearning.Api.Tests;

public sealed class WritingStudioSqlTests
{
    [SqlServerFact]
    public Task Separate_connections_persist_version_history_and_serialize_concurrent_submissions()
    {
        var ai = new WritingVersionTests.WritingHandler();
        return Run((factory, owner, other) => WritingVersionTests.VerifyVersions(factory, ai, owner, other), ai);
    }

    [SqlServerFact]
    public Task Separate_connections_import_and_deduplicate_flashcards_under_concurrent_requests() =>
        Run(FlashcardTests.VerifyWritingImport, new WritingVersionTests.WritingHandler());

    private static async Task Run(Func<WebApplicationFactory<Program>, string, string, Task> verify, HttpMessageHandler ai)
    {
        var connection = SqlServerTestTarget.ConnectionString();
        var options = new DbContextOptionsBuilder<EnglishLearningDbContext>().UseSqlServer(connection).Options;
        var stamp = Guid.NewGuid().ToString("N");
        var owner = $"writing-owner-{stamp}@example.test";
        var other = $"writing-other-{stamp}@example.test";
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder
            .UseEnvironment("Development")
            .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = connection,
                ["Jwt:SigningKey"] = TestJwt.SigningKey
            }))
            .ConfigureServices(services =>
            {
                services.RemoveAll<EnglishLearningDbContext>();
                // Each request gets its own SQL connection/transaction so the application lock is exercised.
                services.AddScoped(_ => new EnglishLearningDbContext(options));
                services.AddHttpClient<WritingAiClient>().ConfigurePrimaryHttpMessageHandler(() => ai);
            }));
        try { await verify(factory, owner, other); }
        finally
        {
            await using var db = new EnglishLearningDbContext(options);
            await using var cleanup = await db.Database.BeginTransactionAsync();
            var users = db.Users.Where(user => user.Email == owner || user.Email == other);
            await db.FlashcardDecks.Where(deck => users.Any(user => user.UserId == deck.UserId)).ExecuteDeleteAsync();
            await db.WritingSubmissions.Where(row => users.Any(user => user.UserId == row.UserId)).ExecuteDeleteAsync();
            await users.ExecuteDeleteAsync();
            await cleanup.CommitAsync();
        }
    }
}
