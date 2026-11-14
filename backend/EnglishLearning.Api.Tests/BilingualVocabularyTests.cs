using System.Net;
using System.Net.Http.Json;
using System.Text;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Documents;
using EnglishLearning.Api.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;

namespace EnglishLearning.Api.Tests;

internal static class BilingualFixture
{
    internal const string Json = """
    {"exists":true,"word":"book","results":[{"lang_code":"en","audio":"/api/v1/tts?word=book&lang=en",
    "meanings":[{"definition":"Sách.","definition_lang":"vi","example":"old book","pos":"Danh từ","source":"Wiktionary","links":["sách"]},
    {"definition":"Sổ sách kế toán.","definition_lang":"vi","pos":"Danh từ","source":"Wiktionary"},
    {"definition":"A book.","definition_lang":"en","pos":"noun"}],
    "pronunciations":[{"ipa":"/bʊk/","region":"US"}],"translations":[{"lang_code":"en","translation":"book"},{"lang_code":"vi","translation":"sách"}],"relations":[]}]}
    """;
    internal static VocabularyPayload Payload() => MinhqndDictionaryClient.Map(Encoding.UTF8.GetBytes(Json), "en-vi");
    internal static VocabularyResponse Response() => new VocabularyEntryDocument("book", Payload(), DateTime.UtcNow, "en-vi").Response("minhqnd", true);
    internal static byte[] Mp3()
    {
        var bytes = new byte[417 * 3];
        for (var offset = 0; offset < bytes.Length; offset += 417)
        { bytes[offset] = 255; bytes[offset + 1] = 251; bytes[offset + 2] = 144; }
        return bytes;
    }
}

public sealed class BilingualVocabularyTests
{
    [Theory]
    [InlineData(" HỌC   SINH ", "vi-en", "học sinh")]
    [InlineData("học sinh", "vi-en", "học sinh")]
    [InlineData("look up", "en-vi", "look up")]
    [InlineData("đường", "vi-en", "đường")]
    public void Normalize_supports_unicode_and_phrases(string input, string direction, string expected)
    { Assert.True(VocabularyWord.TryNormalize(input, direction, out var word)); Assert.Equal(expected, word); }

    [Theory]
    [InlineData("../secret")] [InlineData("học\nsinh")] [InlineData("😀")] [InlineData("a--b")]
    [InlineData("https://example.com")] [InlineData("123")] [InlineData("\u0301abc")]
    public void Invalid_bilingual_input_is_rejected(string input) => Assert.False(VocabularyWord.TryNormalize(input, "vi-en", out _));

    [Fact]
    public void Mapping_filters_definition_and_translation_languages_and_preserves_metadata()
    {
        var payload = BilingualFixture.Payload();
        var entry = Assert.Single(payload.Entries);
        var definitions = Assert.Single(entry.Meanings).Definitions;
        Assert.Equal(2, definitions.Length);
        Assert.All(definitions, definition => Assert.Equal("vi", definition.DefinitionLanguage));
        Assert.Equal("Wiktionary", definitions[0].SourceMetadata!.SourceName);
        Assert.Equal("US", Assert.Single(entry.Phonetics).Region);
        Assert.Null(entry.Phonetics[0].Audio);
        var translations = payload.RawEntries[0]["providerMetadata"]["translations"].AsBsonArray;
        Assert.Equal("vi", Assert.Single(translations)["lang_code"].AsString);
    }

    [Fact]
    public void Missing_target_meanings_is_distinct_from_missing_word()
    {
        var error = Assert.Throws<VocabularyException>(() => MinhqndDictionaryClient.Map(Encoding.UTF8.GetBytes(BilingualFixture.Json), "vi-en"));
        Assert.Equal("definition_language_unavailable", error.Code);
        error = Assert.Throws<VocabularyException>(() => MinhqndDictionaryClient.Map("{\"exists\":false}"u8.ToArray(), "en-vi"));
        Assert.Equal("word_not_found", error.Code);
    }

    [Fact]
    public void Bson_round_trip_rejects_wrong_direction_and_source_language()
    {
        var entry = new VocabularyEntryDocument("book", BilingualFixture.Payload(), DateTime.UtcNow, "en-vi");
        var document = entry.ToBson();
        Assert.Equal(5, document.ElementCount);
        Assert.NotNull(VocabularyEntryDocument.Read(document, "en:book", "en-vi"));
        Assert.Null(VocabularyEntryDocument.Read(document, "en:book", "vi-en"));
        document["entries"][0]["meanings"][0]["definitions"][0]["definitionLanguage"] = "en";
        Assert.Null(VocabularyEntryDocument.Read(document, "en:book", "en-vi"));
    }

    [Fact]
    public void Meaning_identity_is_stable_across_reordering_and_changes_with_content()
    {
        var response = BilingualFixture.Response();
        var definition = response.Entries[0].Meanings[0].Definitions[0];
        var before = VocabularyPresentation.DefinitionId(response, definition, "Danh từ");
        var reordered = response with { Entries = response.Entries.Reverse().ToArray() };
        Assert.Equal(before, VocabularyPresentation.DefinitionId(reordered, definition, "Danh từ"));
        Assert.NotEqual(before, VocabularyPresentation.DefinitionId(response, definition with { Definition = "Một cuốn sách." }, "Danh từ"));
        Assert.NotEqual(before, VocabularyPresentation.DefinitionId(response with { Direction = "en-en" }, definition, "Danh từ"));
    }

    [Fact]
    public void Audio_capability_respects_feature_flag_direction_and_length()
    {
        var response = BilingualFixture.Response();
        var disabled = VocabularyPresentation.Apply(response, new());
        Assert.False(disabled.Entries[0].Meanings[0].Definitions[0].DefinitionAudio!.CanPrepare);
        var enabled = VocabularyPresentation.Apply(response, new() { Enabled = true, MaxTextLength = 10 });
        Assert.True(enabled.Entries[0].Meanings[0].Definitions[0].DefinitionAudio!.CanPrepare);
        Assert.False(enabled.Entries[0].Meanings[0].Definitions[1].DefinitionAudio!.CanPrepare);
    }

    [Fact]
    public async Task Bilingual_lookup_preserves_direction_provider_and_persistence_failure()
    {
        var repository = new MemoryVocabularyRepository { FailWrites = true };
        var source = new FakeDictionaryClient { Fetch = _ => Task.FromResult(BilingualFixture.Payload()) };
        var lookup = new VocabularyLookupService(repository, source, Options.Create(new DictionaryApiSettings()), TimeProvider.System,
            new AudioTestEnvironment(), NullLogger<VocabularyLookupService>.Instance, "en-vi", "minhqnd");
        var result = await lookup.LookupAsync("book", default);
        Assert.Equal("en-vi", result.Direction); Assert.Equal("vi", result.DefinitionLanguage);
        Assert.Equal("minhqnd", result.Provider); Assert.Equal("minhqnd", result.Source); Assert.False(result.IsPersisted);
    }

    [Fact]
    public async Task Http_source_encodes_query_and_converts_malformed_payload_to_502()
    {
        var factory = new AudioTestFactory((request, _) =>
        {
            Assert.Contains("lang=vi&def_lang=en", request.RequestUri!.Query);
            Assert.Contains(Uri.EscapeDataString("học sinh"), request.RequestUri.AbsoluteUri);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(new { invalid = true }) });
        });
        var client = new MinhqndDictionaryClient(new BaseUrlFactory(factory), Options.Create(new MinhqndDictionarySettings()), "vi-en");
        var error = await Assert.ThrowsAsync<VocabularyException>(() => client.LookupAsync("học sinh", default));
        Assert.Equal(502, error.StatusCode);
    }

    private sealed class BaseUrlFactory(IHttpClientFactory factory) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) { var client = factory.CreateClient(name); client.BaseAddress = new("https://dict.minhqnd.com/"); return client; }
    }

    [MongoFact]
    public async Task Separate_collections_validate_and_reuse_bilingual_cache_after_repository_recreation()
    {
        var databaseName = Environment.GetEnvironmentVariable("ENGLISHLEARNING_TEST_MONGODB_DATABASE") ?? "EnglishLearningDictionaryTests";
        Assert.EndsWith("Tests", databaseName);
        var database = new MongoClient(Environment.GetEnvironmentVariable("ENGLISHLEARNING_TEST_MONGODB_CONNECTION_STRING")).GetDatabase(databaseName);
        var suffix = Guid.NewGuid().ToString("N");
        var settings = new MongoDbSettings { EnglishVietnameseCollectionName = "vocabulary_test_envi_" + suffix, VietnameseEnglishCollectionName = "vocabulary_test_vien_" + suffix };
        try
        {
            await MongoVocabularySchema.InitializeAsync(database, settings.EnglishVietnameseCollectionName, default, "en-vi");
            await MongoVocabularySchema.InitializeAsync(database, settings.VietnameseEnglishCollectionName, default, "vi-en");
            var repository = new MongoVocabularyRepository(database, Options.Create(settings), NullLogger<MongoVocabularyRepository>.Instance, "en-vi");
            var entry = new VocabularyEntryDocument("book", BilingualFixture.Payload(), DateTime.UtcNow, "en-vi");
            await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => repository.SaveAsync(entry, default)));
            var recreated = new MongoVocabularyRepository(database, Options.Create(settings), NullLogger<MongoVocabularyRepository>.Instance, "en-vi");
            Assert.Equal("Sách.", (await recreated.FindAsync("en:book", default))!.Payload.Entries[0].Meanings[0].Definitions[0].Definition);
            var invalid = entry.ToBson(); invalid["_id"] = "vi:book";
            await Assert.ThrowsAsync<MongoWriteException>(() => database.GetCollection<BsonDocument>(settings.VietnameseEnglishCollectionName).InsertOneAsync(invalid));
            Assert.Null(await new MongoVocabularyRepository(database, Options.Create(settings), NullLogger<MongoVocabularyRepository>.Instance, "vi-en").FindAsync("vi:book", default));
        }
        finally
        {
            await database.DropCollectionAsync(settings.EnglishVietnameseCollectionName);
            await database.DropCollectionAsync(settings.VietnameseEnglishCollectionName);
        }
    }
}

public sealed class DefinitionAudioTests
{
    private sealed class Lookup : IBilingualVocabularyService
    {
        public Task<VocabularyResponse> LookupAsync(string word, string direction, CancellationToken token) => Task.FromResult(BilingualFixture.Response());
    }

    private sealed class Storage : IDictionaryAudioStorage
    {
        internal CachedDictionaryAudio? Entry;
        internal int Writes;
        public void EnsureWritable() { }
        public Task<CachedDictionaryAudio?> FindAsync(string key, CancellationToken token) => Task.FromResult(Entry?.Key == key ? Entry : null);
        public Task<CachedDictionaryAudio> StoreAsync(string key, DownloadedDictionaryAudio audio, CancellationToken token)
        { Interlocked.Increment(ref Writes); Entry = new(key, new string('b', 64), audio.Extension, audio.ContentType, audio.Bytes.Length, audio.Attribution, DateTime.UtcNow); return Task.FromResult(Entry); }
        public Task<DictionaryAudioPlayback> OpenAsync(CachedDictionaryAudio entry, string? range, CancellationToken token) => throw new NotSupportedException();
    }

    [Fact]
    public void Mpeg_validation_checks_frames_truncation_and_duration()
    {
        var bytes = BilingualFixture.Mp3();
        Assert.InRange(MpegAudioValidation.Validate(bytes, 120), .07, .09);
        Assert.Throws<VocabularyException>(() => MpegAudioValidation.Validate(bytes[..^1], 120));
        Assert.Throws<VocabularyException>(() => MpegAudioValidation.Validate("ID3invalid"u8, 120));
        Assert.Throws<VocabularyException>(() => MpegAudioValidation.Validate(bytes, .01));
    }

    [Fact]
    public void Audio_keys_preserve_punctuation_and_share_equivalent_text()
    {
        Assert.Equal(DefinitionAudioText.Key(" Sách. ", "v1"), DefinitionAudioText.Key("Sách.", "v1"));
        Assert.NotEqual(DefinitionAudioText.Key("Sách.", "v1"), DefinitionAudioText.Key("Sách?", "v1"));
        Assert.NotEqual(DefinitionAudioText.Key("Sách.", "v1"), DefinitionAudioText.Key("Sách.", "v2"));
        Assert.False(DefinitionAudioService.AllowedSource("https://dict.minhqnd.com.evil/api/v1/tts"));
        Assert.False(DefinitionAudioService.AllowedSource("https://user@dict.minhqnd.com/api/v1/tts"));
    }

    [Fact]
    public async Task Preparation_only_speaks_selected_meaning_coalesces_and_reuses_cache()
    {
        var response = BilingualFixture.Response();
        var definition = response.Entries[0].Meanings[0].Definitions[1];
        var request = new DefinitionAudioRequest { Word = "book", DefinitionId = VocabularyPresentation.DefinitionId(response, definition, "Danh từ") };
        var calls = 0;
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var factory = new AudioTestFactory(async (message, token) =>
        {
            Interlocked.Increment(ref calls);
            Assert.Contains(Uri.EscapeDataString("Sổ sách kế toán."), message.RequestUri!.AbsoluteUri);
            await release.Task.WaitAsync(token);
            var content = new ByteArrayContent(BilingualFixture.Mp3()); content.Headers.ContentType = new("audio/mpeg");
            return new(HttpStatusCode.OK) { Content = content };
        });
        var storage = new Storage();
        var service = new DefinitionAudioService(new Lookup(), storage, factory, Options.Create(new DefinitionAudioSettings { Enabled = true }), new AudioTestEnvironment());
        using var cancel = new CancellationTokenSource();
        var canceled = service.PrepareAsync(request, cancel.Token);
        var waiters = Enumerable.Range(0, 10).Select(_ => service.PrepareAsync(request, default)).ToArray();
        cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => canceled);
        release.SetResult();
        await Task.WhenAll(waiters);
        await service.PrepareAsync(request, default);
        Assert.Equal(1, calls); Assert.Equal(1, storage.Writes); Assert.True(storage.Entry!.Attribution.Synthetic);
        Assert.NotNull(await service.FindAsync(storage.Entry.Key, default));
        Assert.Null(await service.FindAsync(new string('c', 64), default));
    }

    [Fact]
    public async Task Disabled_and_changed_selections_never_call_tts()
    {
        var factory = new AudioTestFactory((_, _) => throw new InvalidOperationException("Must not fetch"));
        var service = new DefinitionAudioService(new Lookup(), new Storage(), factory, Options.Create(new DefinitionAudioSettings()), new AudioTestEnvironment());
        Assert.Equal("tts_disabled", (await Assert.ThrowsAsync<VocabularyException>(() => service.PrepareAsync(new(), default))).Code);
        service = new(new Lookup(), new Storage(), factory, Options.Create(new DefinitionAudioSettings { Enabled = true }), new AudioTestEnvironment());
        Assert.Equal("definition_changed", (await Assert.ThrowsAsync<VocabularyException>(() => service.PrepareAsync(new() { Word = "book", DefinitionId = new string('a', 64) }, default))).Code);
    }
}
