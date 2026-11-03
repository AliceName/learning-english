using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Configuration;

public sealed class CloudinaryMediaOptions
{
    public const string SectionName = "CloudinaryMedia";
    [Range(1024, 65536)] public int MaxManifestBytes { get; set; } = 32768;
    [Range(1, 16)] public int MaxConcurrentOperations { get; set; } = 4;
    [Range(10, 180)] public int OperationTimeoutSeconds { get; set; } = 90;
    [Range(1, 300)] public int MetadataCacheSeconds { get; set; } = 60;
    [Range(1, 10000)] public int MetadataCacheEntries { get; set; } = 1000;
}
