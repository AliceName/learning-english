using System.Net;
using System.Text.Json;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Documents;
using Microsoft.Extensions.Options;
using MongoDB.Bson;

namespace EnglishLearning.Api.Services;

public sealed class MinhqndDictionaryClient(IHttpClientFactory factory, IOptions<MinhqndDictionarySettings> configured,
    string direction) : IDictionaryApiClient
{
    public async Task<VocabularyPayload> LookupAsync(string normalizedWord, CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(configured.Value.TimeoutSeconds));
        try
        {
            using var client = factory.CreateClient("MinhqndDictionary");
            var query = $"api/v1/lookup?word={Uri.EscapeDataString(normalizedWord)}&lang={VocabularyWord.Language(direction)}&def_lang={VocabularyWord.DefinitionLanguage(direction)}";
            using var response = await client.GetAsync(query, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if (response.StatusCode == HttpStatusCode.NotFound) throw new VocabularyException(404, "word_not_found", "Chưa tìm thấy từ này.");
            if (response.StatusCode == HttpStatusCode.TooManyRequests) throw new VocabularyException(503, "dictionary_busy", "Nguồn từ điển đang bận. Hãy thử lại sau.", 10);
            if (!response.IsSuccessStatusCode) throw new VocabularyException(503, "dictionary_busy", "Nguồn từ điển tạm thời chưa sẵn sàng.");
            if (response.Content.Headers.ContentType?.MediaType != "application/json") throw Invalid();
            byte[] bytes;
            try { bytes = await DictionaryAudioDownload.ReadLimitedAsync(response.Content, configured.Value.MaxResponseBytes, deadline.Token); }
            catch (VocabularyException error) when (error.Code == "invalid_audio") { throw Invalid(); }
            return Map(bytes, direction);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        { throw new VocabularyException(504, "lookup_timeout", "Tra từ quá thời gian chờ. Vui lòng thử lại."); }
        catch (HttpRequestException)
        { throw new VocabularyException(503, "dictionary_busy", "Chưa kết nối được nguồn từ điển."); }
        catch (Exception error) when (error is JsonException or FormatException or InvalidOperationException or IOException or KeyNotFoundException)
        { throw Invalid(); }
    }

    public static VocabularyPayload Map(ReadOnlyMemory<byte> bytes, string direction)
    {
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 64 });
        var root = document.RootElement;
        if (root.GetProperty("exists").ValueKind == JsonValueKind.False)
            throw new VocabularyException(404, "word_not_found", "Chưa tìm thấy từ này.");
        if (root.GetProperty("exists").ValueKind != JsonValueKind.True || root.GetProperty("results").ValueKind != JsonValueKind.Array) throw Invalid();
        var entries = new BsonArray();
        foreach (var result in root.GetProperty("results").EnumerateArray())
        {
            if (Text(result, "lang_code") != VocabularyWord.Language(direction)) continue;
            var definitions = result.GetProperty("meanings").EnumerateArray()
                .Where(meaning => Text(meaning, "definition_lang") == VocabularyWord.DefinitionLanguage(direction) && !string.IsNullOrWhiteSpace(Text(meaning, "definition")))
                .ToArray();
            if (definitions.Length == 0) continue;
            var phonetics = new BsonArray();
            if (result.TryGetProperty("pronunciations", out var pronunciations) && pronunciations.ValueKind == JsonValueKind.Array)
                foreach (var pronunciation in pronunciations.EnumerateArray())
                    phonetics.Add(new BsonDocument { { "text", Nullable(Text(pronunciation, "ipa")) }, { "audio", BsonNull.Value },
                        { "sourceUrl", BsonNull.Value }, { "license", BsonNull.Value }, { "region", Nullable(Text(pronunciation, "region")) } });
            var meanings = new BsonArray();
            foreach (var group in definitions.GroupBy(meaning => Text(meaning, "pos") is { Length: > 0 } pos ? pos : "Chưa phân loại"))
            {
                var items = new BsonArray(group.Select(meaning => new BsonDocument
                {
                    { "definition", Text(meaning, "definition")!.Trim() }, { "example", Nullable(Text(meaning, "example")) },
                    { "synonyms", new BsonArray() }, { "antonyms", new BsonArray() },
                    { "definitionLanguage", VocabularyWord.DefinitionLanguage(direction) },
                    { "sourceMetadata", new BsonDocument
                        {
                            { "provider", "minhqnd" }, { "sourceName", Nullable(Text(meaning, "source")) },
                            { "sourceUrl", BsonNull.Value }, { "license", BsonNull.Value },
                            { "originalPartOfSpeech", Nullable(Text(meaning, "pos")) }, { "subPartOfSpeech", Nullable(Text(meaning, "sub_pos")) },
                            { "links", Strings(meaning, "links") }
                        }
                    }
                }));
                meanings.Add(new BsonDocument { { "partOfSpeech", group.Key }, { "definitions", items },
                    { "synonyms", Relations(result, "Đồng nghĩa") }, { "antonyms", Relations(result, "Trái nghĩa") } });
            }
            var translations = new BsonArray();
            if (result.TryGetProperty("translations", out var sourceTranslations) && sourceTranslations.ValueKind == JsonValueKind.Array)
                foreach (var translation in sourceTranslations.EnumerateArray())
                    if (Text(translation, "lang_code") == VocabularyWord.DefinitionLanguage(direction))
                        translations.Add(BsonDocument.Parse(translation.GetRawText()));
            entries.Add(new BsonDocument
            {
                { "word", Text(root, "word") is { Length: > 0 } word ? word : throw Invalid() },
                { "phonetic", phonetics.Count > 0 ? phonetics[0]["text"] : BsonNull.Value },
                { "phonetics", phonetics }, { "meanings", meanings }, { "sourceUrls", new BsonArray { "https://dict.minhqnd.com/" } },
                { "providerMetadata", new BsonDocument
                    {
                        { "provider", "minhqnd" }, { "resultLanguage", VocabularyWord.Language(direction) },
                        { "sourceAudioPath", Nullable(Text(result, "audio")) }, { "translations", translations },
                        { "relations", result.TryGetProperty("relations", out var relations) && relations.ValueKind == JsonValueKind.Array
                            ? MongoDB.Bson.Serialization.BsonSerializer.Deserialize<BsonArray>(relations.GetRawText()) : new BsonArray() }
                    }
                }
            });
        }
        if (entries.Count == 0) throw new VocabularyException(404, "definition_language_unavailable", "Mục từ chưa có nghĩa ở hướng tra đã chọn.");
        return VocabularyPayload.FromBson(entries);
    }

    private static BsonArray Relations(JsonElement result, string type) => result.TryGetProperty("relations", out var relations) && relations.ValueKind == JsonValueKind.Array
        ? new BsonArray(relations.EnumerateArray().Where(relation => Text(relation, "relation_type") == type)
            .Select(relation => Text(relation, "related_word")).Where(word => !string.IsNullOrWhiteSpace(word)).Distinct()) : new BsonArray();
    private static BsonArray Strings(JsonElement element, string property) => element.TryGetProperty(property, out var array) && array.ValueKind == JsonValueKind.Array
        ? new BsonArray(array.EnumerateArray().Where(item => item.ValueKind == JsonValueKind.String).Select(item => item.GetString())) : new BsonArray();
    private static string? Text(JsonElement element, string property) => element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static BsonValue Nullable(string? value) => value is null ? BsonNull.Value : new BsonString(value);
    private static VocabularyException Invalid() => new(502, "dictionary_invalid_response", "Nguồn từ điển trả dữ liệu chưa hợp lệ.");
}
