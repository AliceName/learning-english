using System.Collections.Concurrent;
using System.Diagnostics;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Documents;
using Microsoft.Extensions.Options;
using MongoDB.Driver;

namespace EnglishLearning.Api.Services;

public sealed class VocabularyLookupService(IVocabularyRepository repository, IDictionaryApiClient source,
    IOptions<DictionaryApiSettings> options, TimeProvider clock, IHostApplicationLifetime lifetime,
    ILogger<VocabularyLookupService> logger, string direction = "en-en", string sourceProvider = "dictionaryApi", SemaphoreSlim? sourceSlots = null)
{
    private readonly ConcurrentDictionary<string, Lazy<Task<VocabularyResponse>>> flights = new();
    private readonly SemaphoreSlim slots = sourceSlots ?? new(options.Value.MaxConcurrentLookups);

    public async Task<VocabularyResponse> LookupAsync(string word, CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        // Covers the initial Mongo read plus the shared flight's eight-second budget.
        deadline.CancelAfter(TimeSpan.FromSeconds(10));
        try
        {
            var key = VocabularyWord.Key(word, direction);
            var cached = await ReadAsync(key, deadline.Token);
            if (cached is not null) return cached.Response("mongodb", true);
            Lazy<Task<VocabularyResponse>>? candidate = null;
            candidate = new(() => FetchAsync(key, word, candidate!), LazyThreadSafetyMode.ExecutionAndPublication);
            var shared = flights.GetOrAdd(key, candidate);
            return await shared.Value.WaitAsync(deadline.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        { throw new VocabularyException(504, "lookup_timeout", "Tra từ quá thời gian chờ. Vui lòng thử lại."); }
    }

    private async Task<VocabularyResponse> FetchAsync(string key, string word, Lazy<Task<VocabularyResponse>> flight)
    {
        var entered = false;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(lifetime.ApplicationStopping);
        deadline.CancelAfter(TimeSpan.FromSeconds(8));
        try
        {
            entered = await slots.WaitAsync(0, deadline.Token);
            if (!entered) throw new VocabularyException(503, "dictionary_busy", "Hệ thống đang xử lý nhiều từ. Vui lòng thử lại.", 2);
            var cached = await ReadAsync(key, deadline.Token);
            if (cached is not null) return cached.Response("mongodb", true);
            var timer = Stopwatch.StartNew();
            var payload = await source.LookupAsync(word, deadline.Token);
            logger.LogDebug("Vocabulary source completed in {ElapsedMs} ms.", timer.Elapsed.TotalMilliseconds);
            // BSON dates have millisecond precision; return the same timestamp before and after persistence.
            var fetchedAt = DateTimeOffset.FromUnixTimeMilliseconds(clock.GetUtcNow().ToUnixTimeMilliseconds()).UtcDateTime;
            var entry = new VocabularyEntryDocument(word, payload, fetchedAt, direction);
            try
            {
                timer.Restart();
                var stored = await repository.SaveAsync(entry, deadline.Token);
                logger.LogDebug("Vocabulary persistence completed in {ElapsedMs} ms.", timer.Elapsed.TotalMilliseconds);
                return stored.Response(sourceProvider, true);
            }
            catch (Exception error) when (StorageFailure(error))
            {
                logger.LogWarning("Vocabulary write failed ({ErrorType}); returning source data without persistence confirmation.", error.GetType().Name);
                return entry.Response(sourceProvider, false);
            }
        }
        catch (OperationCanceledException) when (!lifetime.ApplicationStopping.IsCancellationRequested)
        { throw new VocabularyException(504, "lookup_timeout", "Tra từ quá thời gian chờ. Vui lòng thử lại."); }
        finally
        {
            if (entered) slots.Release();
            flights.TryRemove(new KeyValuePair<string, Lazy<Task<VocabularyResponse>>>(key, flight));
        }
    }

    private async Task<VocabularyEntryDocument?> ReadAsync(string key, CancellationToken token)
    {
        try
        {
            var timer = Stopwatch.StartNew();
            var entry = await repository.FindAsync(key, token);
            logger.LogDebug("Vocabulary cache {Result} in {ElapsedMs} ms.", entry is null ? "miss" : "hit", timer.Elapsed.TotalMilliseconds);
            return entry;
        }
        catch (Exception error) when (StorageFailure(error) && !token.IsCancellationRequested)
        {
            logger.LogWarning("Vocabulary read failed ({ErrorType}); trying dictionary source.", error.GetType().Name);
            return null;
        }
    }

    private static bool StorageFailure(Exception error) => error is MongoException or TimeoutException or OperationCanceledException or InvalidOperationException;
}
