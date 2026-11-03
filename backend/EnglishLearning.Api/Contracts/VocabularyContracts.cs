namespace EnglishLearning.Api.Contracts;

public sealed record DictionaryLicense(string? Name, string? Url);
public sealed record DictionaryPhonetic(string? Text, string? Audio, string? SourceUrl, DictionaryLicense? License);
public sealed record DictionaryDefinition(string Definition, string? Example, string[] Synonyms, string[] Antonyms);
public sealed record DictionaryMeaning(string PartOfSpeech, DictionaryDefinition[] Definitions, string[] Synonyms, string[] Antonyms);
public sealed record DictionaryEntryResponse(string Word, string? Phonetic, string? Origin,
    DictionaryPhonetic[] Phonetics, DictionaryMeaning[] Meanings, DictionaryLicense? License, string[] SourceUrls);
public sealed record VocabularyResponse(string Word, string Language, string Source, bool IsPersisted,
    DateTime FetchedAtUtc, DictionaryEntryResponse[] Entries);
