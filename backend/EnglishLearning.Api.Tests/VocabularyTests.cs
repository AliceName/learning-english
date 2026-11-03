using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Documents;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.EntityFrameworkCore;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using MongoDB.Driver;

namespace EnglishLearning.Api.Tests;

internal static class VocabularyFixture
{
    internal const string Json = """
    [{"word":"hello","phonetics":[{"audio":"https://example.com/hello.mp3","license":{"name":"CC BY-SA","url":"https://example.com/license"}}],
    "meanings":[{"partOfSpeech":"noun","definitions":[{"definition":"A greeting."},{"definition":"An expression of welcome.","example":"Hello, learner."}],"synonyms":["greeting"]}],
    "license":{"name":"CC BY-SA","url":"https://example.com/license"},"sourceUrls":["https://example.com/hello"],"extraProviderField":"preserved"},
    {"word":"hello","meanings":[{"partOfSpeech":"verb","definitions":[{"definition":"To greet."}]}]}]
    """;
    internal static VocabularyPayload Payload() => VocabularyPayload.FromBson(BsonSerializer.Deserialize<BsonArray>(Json));
    internal static VocabularyEntryDocument Entry(string word = "hello") => new(word, Payload(), DateTime.UtcNow);
    internal static VocabularyLookupService Service(MemoryVocabularyRepository repository, FakeDictionaryClient source, DictionaryApiSettings? options = null) =>
        new(repository, source, Options.Create(options ?? new DictionaryApiSettings()), TimeProvider.System, new Lifetime(), NullLogger<VocabularyLookupService>.Instance);
    private sealed class Lifetime : IHostApplicationLifetime
    {
        public CancellationToken ApplicationStarted => CancellationToken.None;
        public CancellationToken ApplicationStopping => CancellationToken.None;
        public CancellationToken ApplicationStopped => CancellationToken.None;
        public void StopApplication() { }
    }
}

internal sealed class MemoryVocabularyRepository : IVocabularyRepository
{
    internal readonly ConcurrentDictionary<string, VocabularyEntryDocument> Items = new();
    internal int Reads;
    internal int Writes;
    internal bool FailReads;
    internal bool FailWrites;
    public Task<VocabularyEntryDocument?> FindAsync(string key, CancellationToken token)
    {
        Interlocked.Increment(ref Reads);
        if (FailReads) throw new TimeoutException();
        return Task.FromResult(Items.TryGetValue(key, out var value) ? value : null);
    }
    public Task<VocabularyEntryDocument> SaveAsync(VocabularyEntryDocument entry, CancellationToken token)
    {
        Interlocked.Increment(ref Writes);
        if (FailWrites) throw new TimeoutException();
        return Task.FromResult(Items.GetOrAdd(entry.Id, entry));
    }
}

internal sealed class FakeDictionaryClient : IDictionaryApiClient
{
    internal int Calls;
    internal Func<CancellationToken, Task<VocabularyPayload>> Fetch = _ => Task.FromResult(VocabularyFixture.Payload());
    public Task<VocabularyPayload> LookupAsync(string word, CancellationToken token)
    { Interlocked.Increment(ref Calls); return Fetch(token); }
}

public sealed class VocabularyLookupTests
{
    [Theory]
    [InlineData(" Hello ", "hello")]
    [InlineData("HELLO", "hello")]
    [InlineData("mother-in-law", "mother-in-law")]
    [InlineData("don’t", "don't")]
    [InlineData("Café", "café")]
    public void Headwords_are_normalized_once(string input, string expected)
    { Assert.True(VocabularyWord.TryNormalize(input, out var word)); Assert.Equal(expected, word); }

    [Theory]
    [InlineData(null)] [InlineData("")] [InlineData(" ")] [InlineData("hello world")]
    [InlineData("../hello")] [InlineData("hello123")] [InlineData("-")] [InlineData("hello\nworld")]
    [InlineData("hello--world")] [InlineData("😀")]
    public void Invalid_input_is_rejected(string? input) => Assert.False(VocabularyWord.TryNormalize(input, out _));

    [Fact]
    public void Length_is_bounded_and_inflections_keep_distinct_keys()
    {
        Assert.False(VocabularyWord.TryNormalize(new string('a', 101), out _));
        Assert.NotEqual(VocabularyWord.Key("play"), VocabularyWord.Key("played"));
    }

    [Fact]
    public async Task Cache_hit_uses_one_read_no_write_and_no_source_call()
    {
        var repo = new MemoryVocabularyRepository(); var source = new FakeDictionaryClient();
        repo.Items["en:hello"] = VocabularyFixture.Entry();
        var response = await VocabularyFixture.Service(repo, source).LookupAsync("hello", default);
        Assert.Equal("mongodb", response.Source); Assert.True(response.IsPersisted);
        Assert.Equal(1, repo.Reads); Assert.Equal(0, repo.Writes); Assert.Equal(0, source.Calls);
        Assert.Equal(2, response.Entries.Length);
    }

    [Fact]
    public async Task Miss_is_saved_once_and_reused_by_a_new_service_instance()
    {
        var repo = new MemoryVocabularyRepository(); var source = new FakeDictionaryClient();
        var first = await VocabularyFixture.Service(repo, source).LookupAsync("hello", default);
        Assert.Equal("dictionaryApi", first.Source); Assert.True(first.IsPersisted);
        Assert.Equal(2, repo.Reads); // Initial lookup and one recheck, no read after insert.
        source.Fetch = _ => throw new InvalidOperationException("Source must not be called again");
        var second = await VocabularyFixture.Service(repo, source).LookupAsync("hello", default);
        Assert.Equal("mongodb", second.Source); Assert.Equal(first.FetchedAtUtc, second.FetchedAtUtc);
        Assert.Equal(1, repo.Writes); Assert.Equal(1, source.Calls);
    }

    [Fact]
    public async Task Concurrent_waiters_share_source_and_one_cancel_does_not_cancel_others()
    {
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var source = new FakeDictionaryClient { Fetch = async token => { ready.SetResult(); await release.Task.WaitAsync(token); return VocabularyFixture.Payload(); } };
        var repo = new MemoryVocabularyRepository(); var service = VocabularyFixture.Service(repo, source);
        using var cancel = new CancellationTokenSource();
        var canceled = service.LookupAsync("hello", cancel.Token);
        await ready.Task;
        var waiters = Enumerable.Range(0, 20).Select(_ => service.LookupAsync("hello", default)).ToArray();
        cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => canceled);
        release.SetResult();
        var responses = await Task.WhenAll(waiters);
        Assert.All(responses, response => Assert.True(response.IsPersisted));
        Assert.Equal(1, source.Calls); Assert.Equal(1, repo.Writes);
    }

    [Fact]
    public async Task Failed_flights_are_removed_and_no_error_is_persisted()
    {
        var source = new FakeDictionaryClient { Fetch = _ => throw new VocabularyException(404, "word_not_found", "Missing") };
        var repo = new MemoryVocabularyRepository(); var service = VocabularyFixture.Service(repo, source);
        await Assert.ThrowsAsync<VocabularyException>(() => service.LookupAsync("hello", default));
        source.Fetch = _ => Task.FromResult(VocabularyFixture.Payload());
        Assert.True((await service.LookupAsync("hello", default)).IsPersisted);
        Assert.Equal(2, source.Calls); Assert.Equal(1, repo.Writes);
    }

    [Fact]
    public async Task Storage_failure_returns_source_without_persistence_claim()
    {
        var repo = new MemoryVocabularyRepository { FailReads = true, FailWrites = true };
        var result = await VocabularyFixture.Service(repo, new()).LookupAsync("hello", default);
        Assert.False(result.IsPersisted); Assert.Equal("dictionaryApi", result.Source);
    }

    [Fact]
    public async Task Concurrent_new_words_are_bounded_and_capacity_is_released()
    {
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var count = 0;
        var source = new FakeDictionaryClient { Fetch = async token =>
        {
            if (Interlocked.Increment(ref count) == 2) ready.TrySetResult();
            await release.Task.WaitAsync(token); return VocabularyFixture.Payload();
        } };
        var service = VocabularyFixture.Service(new(), source, new DictionaryApiSettings { MaxConcurrentLookups = 2 });
        var first = service.LookupAsync("hello", default); var second = service.LookupAsync("world", default);
        await ready.Task;
        Assert.Equal(503, (await Assert.ThrowsAsync<VocabularyException>(() => service.LookupAsync("busy", default))).StatusCode);
        release.SetResult(); await Task.WhenAll(first, second);
        Assert.True((await service.LookupAsync("busy", default)).IsPersisted);
        Assert.Equal(3, source.Calls);
    }

    [Fact]
    public void Bson_keeps_optional_fields_and_provider_metadata_without_a_json_string()
    {
        var bson = VocabularyFixture.Entry().ToBson();
        Assert.Equal(5, bson.ElementCount); Assert.True(bson["entries"].IsBsonArray);
        Assert.Equal("preserved", bson["entries"][0]["extraProviderField"].AsString);
        var entry = VocabularyEntryDocument.Read(bson, "en:hello")!;
        Assert.Null(entry.Payload.Entries[0].Phonetic);
        Assert.Null(entry.Payload.Entries[0].Meanings[0].Definitions[0].Example);
        Assert.Equal(2, entry.Payload.Entries[0].Meanings[0].Definitions.Length);
        Assert.Equal("CC BY-SA", entry.Payload.Entries[0].Phonetics[0].License!.Name);
        bson["normalizedWord"] = "different";
        Assert.Null(VocabularyEntryDocument.Read(bson, "en:hello"));
    }
}

public sealed class DictionaryApiClientTests
{
    private sealed class Handler(Func<CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => send(token);
    }
    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, false) { BaseAddress = new Uri("https://api.dictionaryapi.dev/api/v2/entries/en/") };
    }
    private static DictionaryApiClient Client(HttpStatusCode status, string body, int maxBytes = 1048576) =>
        new(new Factory(new Handler(_ => Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body) }))),
            Options.Create(new DictionaryApiSettings { MaxResponseBytes = maxBytes }));

    [Fact]
    public async Task Complete_success_maps_multiple_entries_and_missing_optional_fields()
    { Assert.Equal(2, (await Client(HttpStatusCode.OK, VocabularyFixture.Json).LookupAsync("hello", default)).Entries.Length); }

    [Theory]
    [InlineData(404, "{\"title\":\"No Definitions Found\",\"message\":\"Missing\"}", 404)]
    [InlineData(404, "<html>Not found</html>", 502)]
    [InlineData(429, "busy", 503)]
    [InlineData(500, "failure", 502)]
    [InlineData(200, "<html>failure</html>", 502)]
    [InlineData(200, "[]", 502)]
    [InlineData(200, "[{\"word\":\"hello\",\"meanings\":[]}]", 502)]
    [InlineData(200, "{}", 502)]
    public async Task Source_errors_are_classified_before_saving(int status, string body, int expected)
    { Assert.Equal(expected, (await Assert.ThrowsAsync<VocabularyException>(() => Client((HttpStatusCode)status, body).LookupAsync("hello", default))).StatusCode); }

    [Fact]
    public async Task Oversized_response_is_rejected()
    { Assert.Equal(502, (await Assert.ThrowsAsync<VocabularyException>(() => Client(HttpStatusCode.OK, VocabularyFixture.Json, 10).LookupAsync("hello", default))).StatusCode); }

    [Fact]
    public async Task Timeout_and_caller_cancellation_remain_distinct()
    {
        var client = new DictionaryApiClient(new Factory(new Handler(async token => { await Task.Delay(Timeout.Infinite, token); return null!; })),
            Options.Create(new DictionaryApiSettings { TimeoutSeconds = 1 }));
        Assert.Equal(504, (await Assert.ThrowsAsync<VocabularyException>(() => client.LookupAsync("hello", default))).StatusCode);
        using var canceled = new CancellationTokenSource(); canceled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => client.LookupAsync("hello", canceled.Token));
    }

    [Fact]
    public async Task Retry_after_and_network_failures_are_preserved()
    {
        var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
        response.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.FromSeconds(12));
        var client = new DictionaryApiClient(new Factory(new Handler(_ => Task.FromResult(response))), Options.Create(new DictionaryApiSettings()));
        Assert.Equal(12, (await Assert.ThrowsAsync<VocabularyException>(() => client.LookupAsync("hello", default))).RetryAfterSeconds);
        client = new(new Factory(new Handler(_ => throw new HttpRequestException())), Options.Create(new DictionaryApiSettings()));
        Assert.Equal(503, (await Assert.ThrowsAsync<VocabularyException>(() => client.LookupAsync("hello", default))).StatusCode);
    }
}

public sealed class VocabularyAnonymousTests
{
    [Fact]
    public async Task Anonymous_request_is_rejected_before_dictionary_access()
    {
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder
            .UseEnvironment("Development").ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
                new Dictionary<string, string?> { ["Jwt:SigningKey"] = TestJwt.SigningKey })));
        var response = await factory.CreateClient().GetAsync("/api/v1/vocabulary?word=hello");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}

public sealed class LiveDictionaryFactAttribute : FactAttribute
{
    public LiveDictionaryFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("ENGLISHLEARNING_RUN_LIVE_DICTIONARY_TEST") != "1" ||
            string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ENGLISHLEARNING_TEST_CONNECTION_STRING")))
            Skip = "Opt in to the external Dictionary API smoke test with SQL Server test configuration.";
    }
}

public sealed partial class RegistrationSqlServerTests
{
    [LiveDictionaryFact]
    public async Task Vocabulary_live_source_is_saved_and_a_second_account_reads_it_after_app_recreation()
    {
        var firstLogin = await SignIn(await RegisterLoginUser());
        var secondLogin = await SignIn(await RegisterLoginUser());
        var collectionName = $"vocabulary_test_smoke_{Guid.NewGuid():N}";
        void Configure(IWebHostBuilder builder) => builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
            new Dictionary<string, string?>
            {
                ["MongoDbSettings:DatabaseName"] = "EnglishLearningDictionaryTests",
                ["MongoDbSettings:VocabularyCollectionName"] = collectionName
            }));
        await using var firstFactory = factory.WithWebHostBuilder(Configure);
        var database = firstFactory.Services.GetRequiredService<IMongoDatabase>();
        await MongoVocabularySchema.InitializeAsync(database, collectionName, default);
        try
        {
            using var first = firstFactory.CreateClient();
            first.DefaultRequestHeaders.Authorization = new("Bearer", firstLogin.AccessToken);
            var response = await first.GetAsync("/api/v1/vocabulary?word=hello");
            Assert.True(response.IsSuccessStatusCode, $"Live dictionary returned {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
            var body = (await response.Content.ReadFromJsonAsync<VocabularyResponse>())!;
            Assert.True(body.IsPersisted); Assert.Equal("dictionaryApi", body.Source); Assert.NotEmpty(body.Entries);
            var blockedSource = new FakeDictionaryClient { Fetch = _ => throw new InvalidOperationException("Source intentionally blocked after app recreation.") };
            await using var secondFactory = factory.WithWebHostBuilder(builder =>
            {
                Configure(builder);
                builder.ConfigureServices(services =>
                { services.RemoveAll<IDictionaryApiClient>(); services.AddSingleton<IDictionaryApiClient>(blockedSource); });
            });
            using var second = secondFactory.CreateClient();
            second.DefaultRequestHeaders.Authorization = new("Bearer", secondLogin.AccessToken);
            response = await second.GetAsync("/api/v1/vocabulary?word=%20HELLO%20");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var cached = (await response.Content.ReadFromJsonAsync<VocabularyResponse>())!;
            Assert.True(cached.IsPersisted); Assert.Equal("mongodb", cached.Source); Assert.Equal(body.FetchedAtUtc, cached.FetchedAtUtc);
            Assert.Equal(0, blockedSource.Calls);
            Assert.Equal(1, await database.GetCollection<BsonDocument>(collectionName).CountDocumentsAsync(FilterDefinition<BsonDocument>.Empty));
        }
        finally
        {
            if (database.DatabaseNamespace.DatabaseName == "EnglishLearningDictionaryTests" && collectionName.StartsWith("vocabulary_test_smoke_", StringComparison.Ordinal))
                await database.DropCollectionAsync(collectionName);
        }
    }

    [SqlServerFact]
    public async Task Vocabulary_enforces_active_account_and_preserves_http_errors_and_rate_limit()
    {
        var login = await SignIn(await RegisterLoginUser());
        var repo = new MemoryVocabularyRepository(); var source = new FakeDictionaryClient();
        await using var vocabularyFactory = factory.WithWebHostBuilder(builder => builder
            .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> { ["DictionaryApiSettings:RequestsPerMinute"] = "10" }))
            .ConfigureServices(services =>
            {
                services.RemoveAll<IVocabularyRepository>(); services.AddSingleton<IVocabularyRepository>(repo);
                services.RemoveAll<IDictionaryApiClient>(); services.AddSingleton<IDictionaryApiClient>(source);
            }));
        using var http = vocabularyFactory.CreateClient();
        http.DefaultRequestHeaders.Authorization = new("Bearer", login.AccessToken);
        var response = await http.GetAsync("/api/v1/vocabulary?word=%20HELLO%20");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.True(response.Headers.CacheControl?.NoStore);
        Assert.Equal("hello", (await response.Content.ReadFromJsonAsync<VocabularyResponse>())!.Word);
        Assert.Equal(HttpStatusCode.BadRequest, (await http.GetAsync("/api/v1/vocabulary?word=two%20words")).StatusCode);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var user = await db.Users.SingleAsync(user => user.UserId == login.User.UserId);
        user.IsActive = false; await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await http.GetAsync("/api/v1/vocabulary?word=hello")).StatusCode);
        Assert.Equal(1, source.Calls);
        user.IsActive = true; user.Role = "admin"; await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.OK, (await http.GetAsync("/api/v1/vocabulary?word=hello")).StatusCode);
        source.Fetch = _ => throw new VocabularyException(404, "word_not_found", "Missing");
        Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync("/api/v1/vocabulary?word=missing")).StatusCode);
        source.Fetch = _ => throw new VocabularyException(503, "dictionary_busy", "Busy", 7);
        response = await http.GetAsync("/api/v1/vocabulary?word=another");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("7", response.Headers.GetValues("Retry-After").Single());
        for (var i = 0; i < 5; i++) response = await http.GetAsync("/api/v1/vocabulary?word=hello");
        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.True(response.Headers.Contains("Retry-After"));
    }
}
