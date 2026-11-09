namespace EnglishLearning.Api.Contracts;

public sealed record DictionaryLicense(string? Name, string? Url);
public sealed record DictionaryPhonetic(string? Text, string? Audio, string? SourceUrl, DictionaryLicense? License, string? Region = null);
public sealed record DefinitionSourceMetadata(string Provider, string? SourceName, string? SourceUrl, DictionaryLicense? License,
    string? OriginalPartOfSpeech, string? SubPartOfSpeech, string[] Links);
public sealed record DefinitionAudioCapability(bool CanPrepare, string? Reason, string Language);
public sealed record ProviderAttribution(string Name, string Url);
public sealed record DictionaryDefinition(string Definition, string? Example, string[] Synonyms, string[] Antonyms,
    string? DefinitionLanguage = null, DefinitionSourceMetadata? SourceMetadata = null,
    string? DefinitionId = null, DefinitionAudioCapability? DefinitionAudio = null);
public sealed record DictionaryMeaning(string PartOfSpeech, DictionaryDefinition[] Definitions, string[] Synonyms, string[] Antonyms);
public sealed record DictionaryEntryResponse(string Word, string? Phonetic, string? Origin,
    DictionaryPhonetic[] Phonetics, DictionaryMeaning[] Meanings, DictionaryLicense? License, string[] SourceUrls);
public sealed record VocabularyResponse(string Word, string Language, string Source, bool IsPersisted,
    DateTime FetchedAtUtc, DictionaryEntryResponse[] Entries, string Direction = "en-en",
    string DefinitionLanguage = "en", string Provider = "dictionaryApi", ProviderAttribution? ProviderAttribution = null);
