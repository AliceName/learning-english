using System.Net;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services;

public sealed record DownloadedDictionaryAudio(byte[] Bytes, string Extension, string ContentType, AudioAttribution Attribution);
public interface IDictionaryAudioDownload
{
    Task<DownloadedDictionaryAudio> DownloadAsync(DictionaryAudioReference reference, CancellationToken token);
}

public sealed class DictionaryAudioDownload(IHttpClientFactory factory, WikimediaAudioResolver resolver,
    IOptions<DictionaryAudioSettings> options, ILogger<DictionaryAudioDownload> logger) : IDictionaryAudioDownload
{
    public async Task<DownloadedDictionaryAudio> DownloadAsync(DictionaryAudioReference reference, CancellationToken token)
    {
        try
        {
            var original = await resolver.ResolveAsync(reference, token);
            if (original is not null) return await FetchAsync(original, token);
        }
        catch (Exception error) when (!token.IsCancellationRequested && error is VocabularyException or HttpRequestException or IOException or OperationCanceledException or System.Text.Json.JsonException or InvalidOperationException or FormatException)
        { logger.LogDebug("Wikimedia audio unavailable ({ErrorType}); trying allowed dictionary audio.", error.GetType().Name); }
        if (reference.FallbackUrl is null) throw new VocabularyException(503, "audio_unavailable", "Chưa chuẩn bị được âm thanh. Vui lòng thử lại.");
        try
        {
            var url = reference.FallbackUrl;
            return await FetchAsync(new(url, new("dictionaryApi", reference.SourceUrl, url.AbsoluteUri, null,
                reference.License?.Name, reference.License?.Url, WikimediaAudioResolver.Locale(url.AbsolutePath))), token);
        }
        catch (Exception error) when (!token.IsCancellationRequested && error is HttpRequestException or IOException or OperationCanceledException)
        { throw new VocabularyException(503, "audio_unavailable", "Nguồn âm thanh tạm thời chưa sẵn sàng. Vui lòng thử lại."); }
    }

    private async Task<DownloadedDictionaryAudio> FetchAsync(ResolvedDictionaryAudio source, CancellationToken token)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(options.Value.SourceTimeoutSeconds));
        using var client = factory.CreateClient("DictionaryAudio");
        var uri = source.Url;
        for (var redirects = 0; redirects <= 3; redirects++)
        {
            if (!WikimediaAudioResolver.AllowedDownload(uri)) throw InvalidAudio();
            using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if ((int)response.StatusCode is >= 300 and < 400)
            {
                var location = response.Headers.Location;
                if (location is null || redirects == 3) throw InvalidAudio();
                uri = location.IsAbsoluteUri ? location : new Uri(uri, location);
                continue;
            }
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
                throw new VocabularyException(503, "audio_source_busy", "Nguồn âm thanh đang bận. Vui lòng thử lại sau.", 10);
            if (response.StatusCode != HttpStatusCode.OK) throw InvalidAudio();
            var mime = response.Content.Headers.ContentType?.MediaType?.ToLowerInvariant();
            if (mime is null || !(mime.StartsWith("audio/", StringComparison.Ordinal) || mime == "application/ogg")) throw InvalidAudio();
            var bytes = await ReadLimitedAsync(response.Content, options.Value.MaxFileBytes, deadline.Token);
            var format = Detect(bytes);
            if (format is null || !MatchesMime(format.Value.Extension, mime)) throw InvalidAudio();
            return new(bytes, format.Value.Extension, format.Value.Type, source.Attribution with { FileUrl = uri.AbsoluteUri });
        }
        throw InvalidAudio();
    }

    public static (string Extension, string Type)? Detect(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length < 32) return null;
        if (bytes[..4].SequenceEqual("OggS"u8) && (bytes.IndexOf("vorbis"u8) >= 0 || bytes.IndexOf("OpusHead"u8) >= 0)) return ("ogg", "audio/ogg");
        if (bytes[..3].SequenceEqual("ID3"u8) || bytes[0] == 0xff && (bytes[1] & 0xe0) == 0xe0) return ("mp3", "audio/mpeg");
        if (bytes[..4].SequenceEqual("RIFF"u8) && bytes.Slice(8, 4).SequenceEqual("WAVE"u8)) return ("wav", "audio/wav");
        return null;
    }
    private static bool MatchesMime(string extension, string mime) => extension switch
    {
        "ogg" => mime is "audio/ogg" or "application/ogg" or "audio/vorbis" or "audio/opus",
        "mp3" => mime is "audio/mpeg" or "audio/mp3",
        "wav" => mime is "audio/wav" or "audio/wave" or "audio/x-wav" or "audio/vnd.wave",
        _ => false
    };
    public static async Task<byte[]> ReadLimitedAsync(HttpContent content, int maxBytes, CancellationToken token)
    {
        if (content.Headers.ContentLength > maxBytes) throw InvalidAudio();
        await using var stream = await content.ReadAsStreamAsync(token);
        using var output = new MemoryStream();
        var buffer = new byte[8192]; int count;
        while ((count = await stream.ReadAsync(buffer, token)) > 0)
        {
            if (output.Length + count > maxBytes) throw InvalidAudio();
            await output.WriteAsync(buffer.AsMemory(0, count), token);
        }
        if (output.Length == 0) throw InvalidAudio();
        return output.ToArray();
    }
    private static VocabularyException InvalidAudio() => new(502, "invalid_audio", "Nguồn chưa trả tệp âm thanh hợp lệ. Vui lòng thử lại.");
}
