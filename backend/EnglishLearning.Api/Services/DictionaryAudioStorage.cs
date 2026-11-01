using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services;

public sealed record CachedDictionaryAudio(string Key, string ContentHash, string Extension, string ContentType,
    long SizeBytes, AudioAttribution Attribution, DateTime CreatedAtUtc);

public sealed class DictionaryAudioStorage(IOptions<DictionaryAudioSettings> configured, IWebHostEnvironment environment) : IDictionaryAudioStorage
{
    public void EnsureWritable() { }
    private readonly string root = Path.GetFullPath(configured.Value.RootPath ?? Path.Combine(environment.ContentRootPath, "App_Data", "dictionary-audio"));
    private readonly SemaphoreSlim writer = new(1);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static bool Hash(string value) => Regex.IsMatch(value, "\\A[a-f0-9]{64}\\z", RegexOptions.CultureInvariant);
    private string Manifest(string key) => Hash(key) ? Path.Combine(root, key + ".json") : throw new ArgumentException("Invalid cache key.");
    public string PathFor(CachedDictionaryAudio entry) => Hash(entry.ContentHash) && entry.Extension is "ogg" or "mp3" or "wav"
        ? Path.Combine(root, entry.ContentHash + "." + entry.Extension) : throw new ArgumentException("Invalid audio file identity.");

    public async Task<CachedDictionaryAudio?> FindAsync(string key, CancellationToken token)
    {
        try
        {
            await using var manifest = File.OpenRead(Manifest(key));
            if (manifest.Length > 32768) return null;
            var entry = await JsonSerializer.DeserializeAsync<CachedDictionaryAudio>(manifest, Json, token);
            if (entry is null || entry.Key != key || !Hash(entry.ContentHash) || entry.SizeBytes is < 32 || entry.SizeBytes > configured.Value.MaxFileBytes ||
                entry.Extension is not ("ogg" or "mp3" or "wav") || entry.Attribution is null) return null;
            await using var file = new FileStream(PathFor(entry), FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 4096, true);
            if (file.Length != entry.SizeBytes) return null;
            var header = new byte[Math.Min(4096, file.Length)];
            var read = await file.ReadAtLeastAsync(header, header.Length, false, token);
            var detected = DictionaryAudioDownload.Detect(header.AsSpan(0, read));
            return detected is not null && detected.Value.Extension == entry.Extension && detected.Value.Type == entry.ContentType ? entry : null;
        }
        catch (Exception error) when (error is IOException or JsonException or ArgumentException or NotSupportedException) { return null; }
    }

    public async Task<CachedDictionaryAudio> StoreAsync(string key, DownloadedDictionaryAudio audio, CancellationToken token)
    {
        var format = DictionaryAudioDownload.Detect(audio.Bytes);
        if (format is null || format.Value.Extension != audio.Extension || format.Value.Type != audio.ContentType || audio.Bytes.Length > configured.Value.MaxFileBytes)
            throw new VocabularyException(502, "invalid_audio", "Tệp âm thanh chưa hợp lệ.");
        await writer.WaitAsync(token);
        var temporaries = new List<string>();
        try
        {
            var existing = await FindAsync(key, token);
            if (existing is not null) return existing;
            Directory.CreateDirectory(root);
            var hash = Convert.ToHexStringLower(SHA256.HashData(audio.Bytes));
            var entry = new CachedDictionaryAudio(key, hash, audio.Extension, audio.ContentType, audio.Bytes.LongLength, audio.Attribution, DateTime.UtcNow);
            var json = JsonSerializer.SerializeToUtf8Bytes(entry, Json);
            var path = PathFor(entry);
            var required = (File.Exists(path) ? 0 : audio.Bytes.LongLength) + json.LongLength;
            MakeRoom(required, entry.ContentHash, entry.Key);
            // Immutable content-addressed files allow multiple source references to share bytes.
            var validContent = false;
            if (File.Exists(path) && new FileInfo(path).Length == audio.Bytes.LongLength)
            {
                await using var existingFile = File.OpenRead(path);
                validContent = Convert.ToHexStringLower(await SHA256.HashDataAsync(existingFile, token)) == hash;
            }
            if (!validContent)
            {
                var temporary = Path.Combine(root, Guid.NewGuid().ToString("N") + ".tmp"); temporaries.Add(temporary);
                await File.WriteAllBytesAsync(temporary, audio.Bytes, token);
                File.Move(temporary, path, true);
            }
            var metadata = Path.Combine(root, Guid.NewGuid().ToString("N") + ".tmp"); temporaries.Add(metadata);
            await File.WriteAllBytesAsync(metadata, json, token);
            File.Move(metadata, Manifest(key), true);
            return entry;
        }
        finally
        {
            foreach (var temporary in temporaries) { try { File.Delete(temporary); } catch (IOException) { } }
            writer.Release();
        }
    }

    private void MakeRoom(long required, string preserveHash, string preserveKey)
    {
        var files = new DirectoryInfo(root).EnumerateFiles().Where(file => Regex.IsMatch(file.Name, "\\A[a-f0-9]{64}\\.(json|ogg|mp3|wav)\\z")).ToArray();
        var size = files.Sum(file => file.Length);
        foreach (var file in files.OrderBy(file => file.LastWriteTimeUtc))
        {
            if (size + required <= configured.Value.MaxCacheBytes) break;
            var name = Path.GetFileNameWithoutExtension(file.Name);
            if (name == preserveHash || name == preserveKey) continue;
            try { var length = file.Length; file.Delete(); size -= length; } catch (IOException) { }
        }
        if (size + required > configured.Value.MaxCacheBytes) throw new IOException("Dictionary audio cache capacity exhausted.");
    }

    public FileStream OpenRead(CachedDictionaryAudio entry) =>
        new(PathFor(entry), FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 81920, true);

    public Task<DictionaryAudioPlayback> OpenAsync(CachedDictionaryAudio entry, string? range, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        return Task.FromResult(new DictionaryAudioPlayback(OpenRead(entry), entry.ContentType, entry.SizeBytes, EnableRangeProcessing: true));
    }
}
