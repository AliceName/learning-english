using System.Diagnostics;
using System.Text.Json;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Data;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using Xunit.Abstractions;

namespace EnglishLearning.Api.Tests;

public sealed class MongoFactAttribute : FactAttribute
{
    public MongoFactAttribute()
    { if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ENGLISHLEARNING_TEST_MONGODB_CONNECTION_STRING"))) Skip = "Configure a MongoDB test connection to run this integration test."; }
}
public sealed class MongoBenchmarkFactAttribute : FactAttribute
{
    public MongoBenchmarkFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("ENGLISHLEARNING_RUN_VOCABULARY_BENCHMARK") != "1" ||
            string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ENGLISHLEARNING_TEST_MONGODB_CONNECTION_STRING")))
            Skip = "Opt in with ENGLISHLEARNING_RUN_VOCABULARY_BENCHMARK=1 and a MongoDB test connection.";
    }
}

public sealed class MongoVocabularyTests(ITestOutputHelper output) : IAsyncLifetime
{
    private IMongoClient? client;
    private IMongoDatabase database = null!;
    private string collectionName = "";
    private OptionsWrapper<MongoDbSettings> settings = null!;
    public async Task InitializeAsync()
    {
        var uri = Environment.GetEnvironmentVariable("ENGLISHLEARNING_TEST_MONGODB_CONNECTION_STRING");
        if (string.IsNullOrWhiteSpace(uri)) return;
        var name = Environment.GetEnvironmentVariable("ENGLISHLEARNING_TEST_MONGODB_DATABASE") ?? "EnglishLearningDictionaryTests";
        if (!name.EndsWith("Tests", StringComparison.Ordinal)) throw new InvalidOperationException("MongoDB integration database name must end with Tests.");
        client = new MongoClient(uri); database = client.GetDatabase(name);
        collectionName = $"vocabulary_test_{Guid.NewGuid():N}";
        settings = new(new MongoDbSettings { VocabularyCollectionName = collectionName, OperationTimeoutMs = 10000 });
        await MongoVocabularySchema.InitializeAsync(database, collectionName, default);
    }
    public async Task DisposeAsync()
    {
        if (client is null) return;
        if (!database.DatabaseNamespace.DatabaseName.EndsWith("Tests", StringComparison.Ordinal) || !collectionName.StartsWith("vocabulary_test_", StringComparison.Ordinal))
            throw new InvalidOperationException("Refusing to remove a non-test collection.");
        await database.DropCollectionAsync(collectionName);
        client.Dispose();
    }
    private MongoVocabularyRepository Repository() => new(database, settings, NullLogger<MongoVocabularyRepository>.Instance);

    [MongoFact]
    public async Task Concurrent_upserts_remain_unique_and_data_survives_repository_recreation()
    {
        var entry = VocabularyFixture.Entry(); var repo = Repository();
        await Task.WhenAll(Enumerable.Range(0, 30).Select(_ => repo.SaveAsync(entry, default)));
        var collection = database.GetCollection<BsonDocument>(collectionName);
        Assert.Equal(1, await collection.CountDocumentsAsync(FilterDefinition<BsonDocument>.Empty));
        var persisted = await Repository().FindAsync(entry.Id, default);
        Assert.Equal(2, persisted!.Payload.Entries.Length);
        Assert.Equal("preserved", persisted.Payload.RawEntries[0]["extraProviderField"].AsString);
        Assert.InRange(Math.Abs((persisted.FetchedAtUtc - entry.FetchedAtUtc).TotalMilliseconds), 0, 1);
        await MongoVocabularySchema.InitializeAsync(database, collectionName, default); // Idempotent; never discards data.
        Assert.NotNull(await Repository().FindAsync(entry.Id, default));
        var explain = await Explain(entry.Id);
        Assert.Equal(1, explain["executionStats"]["nReturned"].ToInt32());
        Assert.InRange(explain["executionStats"]["totalDocsExamined"].ToInt32(), 0, 1);
        Assert.DoesNotContain("COLLSCAN", explain["queryPlanner"]["winningPlan"].ToJson());
    }

    [MongoFact]
    public async Task Validator_rejects_wrong_types_empty_meanings_and_missing_required_fields()
    {
        var collection = database.GetCollection<BsonDocument>(collectionName);
        var bad = VocabularyFixture.Entry().ToBson(); bad["fetchedAtUtc"] = "not-a-BSON-date";
        Assert.Equal(121, (await Assert.ThrowsAsync<MongoWriteException>(() => collection.InsertOneAsync(bad))).WriteError.Code);
        bad = VocabularyFixture.Entry().ToBson(); bad.Remove("normalizedWord");
        Assert.Equal(121, (await Assert.ThrowsAsync<MongoWriteException>(() => collection.InsertOneAsync(bad))).WriteError.Code);
        bad = VocabularyFixture.Entry().ToBson(); bad["entries"][0]["meanings"] = new BsonArray();
        Assert.Equal(121, (await Assert.ThrowsAsync<MongoWriteException>(() => collection.InsertOneAsync(bad))).WriteError.Code);
        await collection.InsertOneAsync(VocabularyFixture.Entry().ToBson()); // Optional audio/text/example can be absent.
    }

    [MongoFact]
    public async Task Corrupt_cache_is_repaired_without_overwriting_a_valid_entry()
    {
        var collection = database.GetCollection<BsonDocument>(collectionName);
        var corrupt = VocabularyFixture.Entry().ToBson(); corrupt["entries"] = new BsonArray();
        await collection.InsertOneAsync(corrupt, new InsertOneOptions { BypassDocumentValidation = true });
        Assert.Null(await Repository().FindAsync("en:hello", default));
        var repaired = await Repository().SaveAsync(VocabularyFixture.Entry(), default);
        Assert.Equal(2, repaired.Payload.Entries.Length);
        Assert.NotNull(await Repository().FindAsync("en:hello", default));
    }

    private Task<BsonDocument> Explain(string key) => database.RunCommandAsync<BsonDocument>(new BsonDocument
    {
        { "explain", new BsonDocument { { "find", collectionName }, { "filter", new BsonDocument("_id", key) }, { "limit", 1 } } },
        { "verbosity", "executionStats" }
    });

    [MongoBenchmarkFact]
    public async Task Indexed_reads_are_measured_at_10k_and_100k_documents()
    {
        var collection = database.GetCollection<BsonDocument>(collectionName);
        var payload = VocabularyFixture.Payload();
        var samples = new List<object>();
        var previousCount = 0;
        foreach (var size in new[] { 10000, 100000 })
        {
            for (var offset = previousCount; offset < size; offset += 1000)
            {
                var docs = Enumerable.Range(offset, Math.Min(1000, size - offset))
                    .Select(i => new EnglishLearning.Api.Documents.VocabularyEntryDocument(Word(i), payload, DateTime.UtcNow).ToBson());
                await collection.InsertManyAsync(docs);
            }
            previousCount = size;
            var random = new Random(42);
            var dbTimes = new List<double>(); var mappingTimes = new List<double>();
            for (var i = 0; i < 220; i++)
            {
                var key = "en:" + Word(random.Next(size));
                var watch = Stopwatch.StartNew();
                var doc = await collection.Find(new BsonDocument("_id", key)).FirstOrDefaultAsync();
                var dbMs = watch.Elapsed.TotalMilliseconds; watch.Restart();
                Assert.NotNull(EnglishLearning.Api.Documents.VocabularyEntryDocument.Read(doc, key));
                var mapMs = watch.Elapsed.TotalMilliseconds;
                if (i >= 20) { dbTimes.Add(dbMs); mappingTimes.Add(mapMs); }
            }
            var explain = await Explain("en:" + Word(size / 2));
            var missing = await Explain("en:absentword");
            Assert.InRange(explain["executionStats"]["totalDocsExamined"].ToInt32(), 0, 1);
            Assert.Equal(0, missing["executionStats"]["totalDocsExamined"].ToInt32());
            Assert.DoesNotContain("COLLSCAN", explain["queryPlanner"]["winningPlan"].ToJson());
            samples.Add(new { documentCount = size, samples = dbTimes.Count, dbP50Ms = Percentile(dbTimes, .5), dbP95Ms = Percentile(dbTimes, .95),
                mappingP50Ms = Percentile(mappingTimes, .5), mappingP95Ms = Percentile(mappingTimes, .95),
                examined = explain["executionStats"]["totalDocsExamined"].ToInt32(), documentBytes = VocabularyFixture.Entry().ToBson().ToBson().Length });
        }
        var report = JsonSerializer.Serialize(new { measuredAtUtc = DateTime.UtcNow, note = "Local MongoDB; synthetic documents; warm connection pool; excludes SQL auth, proxy and network to browser.", samples }, new JsonSerializerOptions { WriteIndented = true });
        output.WriteLine(report);
        var path = Environment.GetEnvironmentVariable("ENGLISHLEARNING_VOCABULARY_BENCHMARK_REPORT");
        if (!string.IsNullOrWhiteSpace(path)) await File.WriteAllTextAsync(path, report);
    }
    private static double Percentile(List<double> values, double p) => values.Order().ElementAt((int)Math.Ceiling(values.Count * p) - 1);
    private static string Word(int number)
    {
        var word = "";
        do { word = (char)('a' + number % 26) + word; number = number / 26 - 1; } while (number >= 0);
        return "loadword" + word;
    }
}
