using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Configuration;

public sealed class DictionaryAudioSettings
{
    public const string SectionName = "DictionaryAudioSettings";
    public string? RootPath { get; set; }
    [Range(1024, 10485760)] public int MaxFileBytes { get; set; } = 5 * 1024 * 1024;
    [Range(typeof(long), "10485760", "10737418240")] public long MaxCacheBytes { get; set; } = 512L * 1024 * 1024;
    [Range(1, 16)] public int MaxConcurrentPreparations { get; set; } = 4;
    [Range(1, 128)] public int MaxPendingPreparations { get; set; } = 32;
    [Range(5, 90)] public int PreparationTimeoutSeconds { get; set; } = 90;
    [Range(1, 12)] public int SourceTimeoutSeconds { get; set; } = 10;
    [Range(1, 600)] public int RequestsPerMinute { get; set; } = 120;
    [Required] public string UserAgent { get; set; } = "EnglishLearningSystem/1.0 (educational dictionary audio cache)";
}
