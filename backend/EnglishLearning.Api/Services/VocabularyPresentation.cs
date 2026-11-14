using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Services;

public static class VocabularyPresentation
{
    public static string? NormalizeText(string? text) => text?.Replace("\r\n", "\n").Replace('\r', '\n').Normalize(NormalizationForm.FormC).Trim();
    public static string DefinitionId(VocabularyResponse response, DictionaryDefinition definition, string partOfSpeech) =>
        Hash(new string?[] { "definition-v1", response.Direction, response.Word, response.Provider,
            NormalizeText(definition.SourceMetadata?.SourceName), NormalizeText(definition.SourceMetadata?.OriginalPartOfSpeech ?? partOfSpeech),
            NormalizeText(definition.SourceMetadata?.SubPartOfSpeech), response.DefinitionLanguage,
            NormalizeText(definition.Definition), NormalizeText(definition.Example) });
    public static string Hash(string?[] values) => Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(values)));

    public static VocabularyResponse Apply(VocabularyResponse response, DefinitionAudioSettings settings) => response with
    {
        ProviderAttribution = response.Provider == "minhqnd" ? new("@minhqnd", "https://dict.minhqnd.com/") : new("Free Dictionary API", "https://dictionaryapi.dev/"),
        Entries = response.Entries.Select(entry => entry with
        {
            Meanings = entry.Meanings.Select(meaning => meaning with
            {
                Definitions = meaning.Definitions.Select(definition =>
                {
                    var reason = !settings.Enabled ? "feature_disabled" : response.Direction != "en-vi" ? "unsupported_direction"
                        : string.IsNullOrWhiteSpace(definition.Definition) ? "missing_text"
                        : DefinitionAudioText.Spoken(definition.Definition).Length > settings.MaxTextLength ? "text_too_long" : null;
                    return definition with { DefinitionId = DefinitionId(response, definition, meaning.PartOfSpeech),
                        DefinitionLanguage = response.DefinitionLanguage, DefinitionAudio = new(reason is null, reason, response.DefinitionLanguage) };
                }).ToArray()
            }).ToArray()
        }).ToArray()
    };
}

public static class DefinitionAudioText
{
    public static string Spoken(string text) => System.Text.RegularExpressions.Regex.Replace(VocabularyPresentation.NormalizeText(text)!, @"\s+", " ");
    public static string Key(string text, string voiceProfile) => VocabularyPresentation.Hash(["definition-tts-v1", "minhqnd-tts", "vi", voiceProfile, Spoken(text)]);
    public static bool IsKey(string? key) => key is { Length: 64 } && key.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');
}
