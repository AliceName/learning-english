using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services;
using MongoDB.Bson;

namespace EnglishLearning.Api.Documents;

// Only ToBson() determines the five persisted fields; DTOs are not database fields.
public sealed record VocabularyEntryDocument(string NormalizedWord, VocabularyPayload Payload, DateTime FetchedAtUtc)
{
    public string Id => VocabularyWord.Key(NormalizedWord);
    public BsonDocument ToBson() => new()
    {
        { "_id", Id }, { "language", "en" }, { "normalizedWord", NormalizedWord },
        { "entries", Payload.RawEntries }, { "fetchedAtUtc", new BsonDateTime(FetchedAtUtc) }
    };

    public VocabularyResponse Response(string source, bool persisted) =>
        new(NormalizedWord, "en", source, persisted, FetchedAtUtc, Payload.Entries);

    public static VocabularyEntryDocument? Read(BsonDocument doc, string key)
    {
        try
        {
            var word = doc["normalizedWord"].AsString;
            if (!VocabularyWord.TryNormalize(word, out var normalized) || normalized != word ||
                key != VocabularyWord.Key(word) || doc["_id"].AsString != key || doc["language"].AsString != "en") return null;
            return new(word, VocabularyPayload.FromBson(doc["entries"].AsBsonArray), doc["fetchedAtUtc"].AsBsonDateTime.ToUniversalTime());
        }
        catch (Exception error) when (error is FormatException or InvalidCastException or KeyNotFoundException or ArgumentException)
        { return null; }
    }
}

public sealed record VocabularyPayload(BsonArray RawEntries, DictionaryEntryResponse[] Entries)
{
    public static VocabularyPayload FromBson(BsonArray entries)
    {
        if (entries.Count == 0) throw new FormatException("Empty dictionary response.");
        return new(entries, entries.Select(value => Entry(value.AsBsonDocument)).ToArray());
    }

    private static DictionaryEntryResponse Entry(BsonDocument entry)
    {
        var meanings = Array(entry, "meanings");
        if (meanings.Count == 0) throw new FormatException("Missing meanings.");
        return new(Text(entry, "word", true)!, Text(entry, "phonetic"), Text(entry, "origin"),
            Array(entry, "phonetics").Select(value =>
            {
                var phonetic = value.AsBsonDocument;
                return new DictionaryPhonetic(Text(phonetic, "text"), Text(phonetic, "audio"), Text(phonetic, "sourceUrl"), License(phonetic));
            }).ToArray(), meanings.Select(value =>
            {
                var meaning = value.AsBsonDocument;
                var definitions = Array(meaning, "definitions");
                if (definitions.Count == 0) throw new FormatException("Missing definitions.");
                return new DictionaryMeaning(Text(meaning, "partOfSpeech", true)!, definitions.Select(item =>
                {
                    var definition = item.AsBsonDocument;
                    return new DictionaryDefinition(Text(definition, "definition", true)!, Text(definition, "example"),
                        Strings(definition, "synonyms"), Strings(definition, "antonyms"));
                }).ToArray(), Strings(meaning, "synonyms"), Strings(meaning, "antonyms"));
            }).ToArray(), License(entry), Strings(entry, "sourceUrls"));
    }

    private static BsonArray Array(BsonDocument doc, string name) =>
        !doc.TryGetValue(name, out var value) || value.IsBsonNull ? [] : value.AsBsonArray;
    private static string[] Strings(BsonDocument doc, string name) => Array(doc, name).Select(value => value.AsString).ToArray();
    private static string? Text(BsonDocument doc, string name, bool required = false)
    {
        var text = !doc.TryGetValue(name, out var value) || value.IsBsonNull ? null : value.AsString;
        if (required && string.IsNullOrWhiteSpace(text)) throw new FormatException($"Missing {name}.");
        return text;
    }
    private static DictionaryLicense? License(BsonDocument doc)
    {
        if (!doc.TryGetValue("license", out var value) || value.IsBsonNull) return null;
        var license = value.AsBsonDocument;
        return new(Text(license, "name"), Text(license, "url"));
    }
}
