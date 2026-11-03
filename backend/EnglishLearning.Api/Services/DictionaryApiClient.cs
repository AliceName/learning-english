using System.Net;
using System.Text;
using System.Text.Json;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Documents;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace EnglishLearning.Api.Services;

public interface IDictionaryApiClient
{
    Task<VocabularyPayload> LookupAsync(string normalizedWord, CancellationToken cancellationToken);
}

public sealed class VocabularyException(int statusCode, string code, string message, int? retryAfterSeconds = null) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
    public string Code { get; } = code;
    public int? RetryAfterSeconds { get; } = retryAfterSeconds;
}

public sealed class DictionaryApiClient(IHttpClientFactory factory, IOptions<DictionaryApiSettings> configured) : IDictionaryApiClient
{
    public async Task<VocabularyPayload> LookupAsync(string normalizedWord, CancellationToken cancellationToken)
    {
        var options = configured.Value;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(options.TimeoutSeconds));
        try
        {
            using var client = factory.CreateClient("DictionaryApi");
            using var response = await client.GetAsync(Uri.EscapeDataString(normalizedWord), HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                var delay = response.Headers.RetryAfter?.Delta ?? response.Headers.RetryAfter?.Date - DateTimeOffset.UtcNow;
                throw new VocabularyException(503, "dictionary_busy", "Dịch vụ từ điển đang bận. Vui lòng thử lại sau.",
                    delay is null ? null : Math.Clamp((int)Math.Ceiling(delay.Value.TotalSeconds), 1, 300));
            }
            if (response.StatusCode != HttpStatusCode.NotFound && !response.IsSuccessStatusCode) throw InvalidSource();
            if (response.Content.Headers.ContentLength > options.MaxResponseBytes) throw InvalidSource();
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var body = new MemoryStream();
            var buffer = new byte[8192];
            int count;
            while ((count = await stream.ReadAsync(buffer, timeout.Token)) > 0)
            {
                if (body.Length + count > options.MaxResponseBytes) throw InvalidSource();
                await body.WriteAsync(buffer.AsMemory(0, count), timeout.Token);
            }
            var json = Encoding.UTF8.GetString(body.GetBuffer(), 0, (int)body.Length);
            using var parsed = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 64 });
            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                var root = parsed.RootElement;
                if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("title", out var title) &&
                    title.ValueKind == JsonValueKind.String && title.GetString() == "No Definitions Found" &&
                    root.TryGetProperty("message", out var message) && message.ValueKind == JsonValueKind.String)
                    throw new VocabularyException(404, "word_not_found", "Chưa tìm thấy từ này. Hãy kiểm tra lại cách viết.");
                throw InvalidSource();
            }
            if (parsed.RootElement.ValueKind != JsonValueKind.Array) throw InvalidSource();
            return VocabularyPayload.FromBson(BsonSerializer.Deserialize<BsonArray>(json));
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        { throw new VocabularyException(504, "dictionary_timeout", "Tra từ quá thời gian chờ. Vui lòng thử lại."); }
        catch (Exception error) when (error is HttpRequestException or IOException)
        { throw new VocabularyException(503, "dictionary_unavailable", "Chưa kết nối được dịch vụ từ điển. Vui lòng thử lại."); }
        catch (Exception error) when (error is JsonException or FormatException or InvalidCastException or BsonSerializationException)
        { throw InvalidSource(); }
    }

    private static VocabularyException InvalidSource() => new(502, "dictionary_invalid_response", "Dịch vụ từ điển chưa trả kết quả hợp lệ. Vui lòng thử lại.");
}
