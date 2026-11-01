using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services;

public sealed record DictionaryAudioReference(string Identity, string? PageId, string? FileTitle,
    string? SourceUrl, Uri? FallbackUrl, DictionaryLicense? License)
{
    public string Key => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Identity)));
}
public sealed record ResolvedDictionaryAudio(Uri Url, AudioAttribution Attribution);

public sealed class WikimediaAudioResolver(IHttpClientFactory factory, IOptions<DictionaryAudioSettings> options)
{
    public static DictionaryAudioReference? Identify(DictionaryPhonetic phonetic)
    {
        string? pageId = null, title = null;
        Uri? source = Https(phonetic.SourceUrl);
        if (source?.Host == "commons.wikimedia.org")
        {
            if (source.AbsolutePath == "/w/index.php")
            {
                var query = QueryHelpers.ParseQuery(source.Query);
                if (query.TryGetValue("curid", out var value) && long.TryParse(value.ToString(), out var id) && id > 0)
                    pageId = id.ToString(System.Globalization.CultureInfo.InvariantCulture);
            }
            else if (source.AbsolutePath.StartsWith("/wiki/File:", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    title = Uri.UnescapeDataString(source.AbsolutePath[6..]).Replace('_', ' ').Normalize();
                    if (title.Length is < 6 or > 300 || title.Any(char.IsControl)) title = null;
                }
                catch (ArgumentException) { title = null; }
            }
        }
        var fallback = Https(phonetic.Audio);
        if (fallback is not null && !AllowedDownload(fallback)) fallback = null;
        if (pageId is null && title is null && fallback is null) return null;
        var identity = pageId is not null ? "commons:page:" + pageId : title is not null ? "commons:title:" + title : "audio:" + fallback!.AbsoluteUri;
        return new(identity, pageId, title, pageId is not null || title is not null ? source!.AbsoluteUri : null, fallback, phonetic.License);
    }

    public async Task<ResolvedDictionaryAudio?> ResolveAsync(DictionaryAudioReference reference, CancellationToken token)
    {
        if (reference.PageId is null && reference.FileTitle is null) return null;
        var query = new Dictionary<string, string?>
        {
            ["action"] = "query", ["prop"] = "imageinfo", ["iiprop"] = "url|mime|size|extmetadata",
            ["format"] = "json", ["formatversion"] = "2", ["redirects"] = "1"
        };
        query[reference.PageId is null ? "titles" : "pageids"] = reference.PageId ?? reference.FileTitle;
        var uri = QueryHelpers.AddQueryString("https://commons.wikimedia.org/w/api.php", query);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(Math.Min(5, options.Value.SourceTimeoutSeconds)));
        using var client = factory.CreateClient("DictionaryAudio");
        using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
        if (!response.IsSuccessStatusCode) throw Unavailable();
        var bytes = await DictionaryAudioDownload.ReadLimitedAsync(response.Content, 256 * 1024, deadline.Token);
        using var json = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 32 });
        if (!json.RootElement.TryGetProperty("query", out var result) || !result.TryGetProperty("pages", out var pages)) throw Unavailable();
        foreach (var page in pages.EnumerateArray())
        {
            if (!page.TryGetProperty("imageinfo", out var info) || info.GetArrayLength() == 0) continue;
            var image = info[0];
            var url = Https(String(image, "url"));
            if (url is null || url.Host != "upload.wikimedia.org" || !AllowedDownload(url)) throw Unavailable();
            if (image.TryGetProperty("size", out var size) && size.TryGetInt64(out var length) && length > options.Value.MaxFileBytes)
                throw new VocabularyException(502, "audio_too_large", "Bản thu vượt quá kích thước cho phép.");
            var author = Metadata(image, "Artist");
            var license = Metadata(image, "LicenseShortName") ?? reference.License?.Name;
            var licenseUrl = Metadata(image, "LicenseUrl") ?? reference.License?.Url;
            return new(url, new("wikimedia", reference.SourceUrl, url.AbsoluteUri, author, license, licenseUrl, Locale(String(page, "title") ?? url.AbsolutePath)));
        }
        throw Unavailable();
    }

    public static Uri? Https(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        if (text.StartsWith("//", StringComparison.Ordinal)) text = "https:" + text;
        return Uri.TryCreate(text, UriKind.Absolute, out var uri) && uri.Scheme == "https" && uri.IsDefaultPort && string.IsNullOrEmpty(uri.UserInfo) ? uri : null;
    }

    public static bool AllowedDownload(Uri uri)
    {
        if (Https(uri.AbsoluteUri) is null || uri.AbsolutePath.Split('/').Any(part => Uri.UnescapeDataString(part) is ".." or ".")) return false;
        return uri.Host switch
        {
            "upload.wikimedia.org" => uri.AbsolutePath.StartsWith("/wikipedia/commons/", StringComparison.Ordinal),
            "api.dictionaryapi.dev" => uri.AbsolutePath.StartsWith("/media/pronunciations/en/", StringComparison.Ordinal),
            "ssl.gstatic.com" => uri.AbsolutePath.StartsWith("/dictionary/static/sounds/", StringComparison.Ordinal),
            _ => false
        };
    }

    public static string? Locale(string text)
    {
        text = text.ToLowerInvariant();
        if (Regex.IsMatch(text, @"(?:en[-_]us[-_]|-us\.(?:mp3|ogg)$)")) return "en-US";
        if (Regex.IsMatch(text, @"(?:en[-_](?:uk|gb)[-_]|-(?:uk|gb)\.(?:mp3|ogg)$)")) return "en-GB";
        return null;
    }
    private static string? String(JsonElement element, string name) => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static string? Metadata(JsonElement image, string name)
    {
        if (!image.TryGetProperty("extmetadata", out var metadata) || !metadata.TryGetProperty(name, out var field)) return null;
        var text = String(field, "value");
        if (text is null) return null;
        var plain = WebUtility.HtmlDecode(Regex.Replace(text, "<[^>]*>", " ")).Trim();
        return plain[..Math.Min(4000, plain.Length)];
    }
    private static VocabularyException Unavailable() => new(502, "wikimedia_audio_unavailable", "Chưa lấy được bản thu Wikimedia. Vui lòng thử lại.");
}
