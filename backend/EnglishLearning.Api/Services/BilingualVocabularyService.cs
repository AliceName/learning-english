using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using Microsoft.Extensions.Options;
using MongoDB.Driver;

namespace EnglishLearning.Api.Services;

public interface IBilingualVocabularyService
{
    Task<VocabularyResponse> LookupAsync(string word, string direction, CancellationToken token);
}

public sealed class BilingualVocabularyService : IBilingualVocabularyService
{
    private readonly Dictionary<string, VocabularyLookupService> lookups;

    public BilingualVocabularyService(IMongoDatabase database, IOptions<MongoDbSettings> mongoOptions,
        IHttpClientFactory factory, IOptions<MinhqndDictionarySettings> providerOptions, IOptions<DictionaryApiSettings> limits,
        TimeProvider clock, IHostApplicationLifetime lifetime, ILoggerFactory loggerFactory, SemaphoreSlim sourceSlots)
    {
        lookups = new[] { "en-vi", "vi-en" }.ToDictionary(direction => direction, direction => new VocabularyLookupService(
            new MongoVocabularyRepository(database, mongoOptions, loggerFactory.CreateLogger<MongoVocabularyRepository>(), direction),
            new MinhqndDictionaryClient(factory, providerOptions, direction), limits, clock, lifetime,
            loggerFactory.CreateLogger<VocabularyLookupService>(), direction, "minhqnd", sourceSlots));
    }

    public Task<VocabularyResponse> LookupAsync(string word, string direction, CancellationToken token) => lookups[direction].LookupAsync(word, token);
}
