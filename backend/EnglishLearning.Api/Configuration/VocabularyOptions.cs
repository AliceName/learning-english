using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Configuration;

public sealed class MongoDbSettings
{
    public const string SectionName = "MongoDbSettings";
    [Required] public string ConnectionString { get; set; } = "mongodb://localhost:27017";
    [Required] public string DatabaseName { get; set; } = "EnglishLearningDB";
    [Required] public string VocabularyCollectionName { get; set; } = "VocabularyEntries";
    [Required] public string EnglishVietnameseCollectionName { get; set; } = "VocabularyEntriesEnVi";
    [Required] public string VietnameseEnglishCollectionName { get; set; } = "VocabularyEntriesViEn";
    [Range(100, 10000)] public int OperationTimeoutMs { get; set; } = 1000;
}

public sealed class MinhqndDictionarySettings
{
    [Range(1, 15)] public int TimeoutSeconds { get; set; } = 5;
    [Range(1024, 2097152)] public int MaxResponseBytes { get; set; } = 1048576;
}

public sealed class DefinitionAudioSettings
{
    public bool Enabled { get; set; }
    [Range(1, 500)] public int MaxTextLength { get; set; } = 500;
    [Required, StringLength(100)] public string VoiceProfile { get; set; } = "provider-default-v1";
    [Range(32, 5242880)] public int MaxFileBytes { get; set; } = 5242880;
    [Range(1, 120)] public int MaxDurationSeconds { get; set; } = 120;
    [Range(1, 30)] public int SourceTimeoutSeconds { get; set; } = 10;
    [Range(10, 90)] public int PreparationTimeoutSeconds { get; set; } = 90;
    [Range(1, 8)] public int MaxConcurrentPreparations { get; set; } = 4;
    [Range(1, 64)] public int MaxPendingPreparations { get; set; } = 32;
    [Range(1, 120)] public int RequestsPerMinute { get; set; } = 30;
}

public sealed class DictionaryApiSettings
{
    public const string SectionName = "DictionaryApiSettings";
    [Range(1, 15)] public int TimeoutSeconds { get; set; } = 5;
    [Range(1024, 2097152)] public int MaxResponseBytes { get; set; } = 1048576;
    [Range(1, 128)] public int MaxConcurrentLookups { get; set; } = 32;
    [Range(1, 300)] public int RequestsPerMinute { get; set; } = 30;
}
