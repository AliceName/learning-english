using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public sealed class DictionaryAudioRequest
{
    [Required, StringLength(300)] public string Word { get; init; } = "";
    [Range(0, 200)] public int Entry { get; init; }
    [Range(0, 200)] public int Phonetic { get; init; }
}

public sealed record AudioAttribution(string Provider, string? SourceUrl, string FileUrl, string? Author,
    string? LicenseName, string? LicenseUrl, string? Locale, bool Synthetic = false, string? VoiceProfile = null);
public sealed record DictionaryAudioReadyResponse(string Status, string PlaybackUrl, string ContentType,
    long SizeBytes, AudioAttribution Attribution);
