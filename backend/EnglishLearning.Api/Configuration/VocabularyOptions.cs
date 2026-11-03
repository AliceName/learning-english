using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Configuration;

public sealed class MongoDbSettings
{
    public const string SectionName = "MongoDbSettings";
    [Required] public string ConnectionString { get; set; } = "mongodb://localhost:27017";
    [Required] public string DatabaseName { get; set; } = "EnglishLearningDB";
    [Required] public string VocabularyCollectionName { get; set; } = "VocabularyEntries";
    [Range(100, 10000)] public int OperationTimeoutMs { get; set; } = 1000;
}

public sealed class DictionaryApiSettings
{
    public const string SectionName = "DictionaryApiSettings";
    [Range(1, 15)] public int TimeoutSeconds { get; set; } = 5;
    [Range(1024, 2097152)] public int MaxResponseBytes { get; set; } = 1048576;
    [Range(1, 128)] public int MaxConcurrentLookups { get; set; } = 32;
    [Range(1, 300)] public int RequestsPerMinute { get; set; } = 30;
}
