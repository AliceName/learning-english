using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public sealed class DefinitionAudioRequest
{
    [Required, StringLength(300)] public string Word { get; init; } = "";
    [Required] public string Direction { get; init; } = "en-vi";
    [Required, RegularExpression("^[a-f0-9]{64}$")] public string DefinitionId { get; init; } = "";
}

public sealed record DefinitionAudioReadyResponse(string Status, string DefinitionId, string AudioKey, string PlaybackUrl,
    string ContentType, long SizeBytes, AudioAttribution Attribution);
