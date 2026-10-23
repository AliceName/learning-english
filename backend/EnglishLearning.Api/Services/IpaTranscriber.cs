using System.Collections.Frozen;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Services;

/// <summary>Offline General American word pronunciations; does not infer sentence context or connected speech.</summary>
public sealed partial class IpaTranscriber
{
    private readonly Lazy<FrozenDictionary<string, string[]>> dictionary = new(LoadDictionary);

    public GenerateIpaResponse Transcribe(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        if (string.IsNullOrWhiteSpace(text) || text.Length > 1000)
            throw new ArgumentException("Nhập câu tiếng Anh từ 1 đến 1000 ký tự.", nameof(text));

        var unknown = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match symbol in UnsupportedSymbols().Matches(text)) unknown.Add(symbol.Value);
        var alternatives = new Dictionary<string, IpaAlternative>(StringComparer.OrdinalIgnoreCase);
        var hasWords = false;
        // Preserve whitespace/punctuation; tokenize Unicode words as a whole so foreign text is never silently dropped.
        var transcription = WordOrNumber().Replace(text.Trim(), match =>
        {
            hasWords = true;
            var word = match.Value.Replace('’', '\'').ToLowerInvariant();
            if (dictionary.Value.TryGetValue(word, out var pronunciations))
            {
                if (pronunciations.Length > 1) alternatives.TryAdd(word, new(word, pronunciations));
                return pronunciations[0].Trim('/');
            }
            // Productive hyphenated compounds can use the pronunciations of their individual words.
            var parts = word.Split('-');
            if (parts.Length > 1 && parts.All(dictionary.Value.ContainsKey))
            {
                return string.Join(" ", parts.Select(part =>
                {
                    var choices = dictionary.Value[part];
                    if (choices.Length > 1) alternatives.TryAdd(part, new(part, choices));
                    return choices[0].Trim('/');
                }));
            }
            unknown.Add(match.Value);
            return match.Value;
        });
        // A partial sentence containing spelling in place of phonemes must never be presented as complete IPA.
        var ipa = hasWords && unknown.Count == 0 ? $"/{Whitespace().Replace(transcription, " ")}/" : null;
        return new(ipa, "en-US", unknown.ToArray(), alternatives.Values.ToArray());
    }

    private static FrozenDictionary<string, string[]> LoadDictionary()
    {
        using var resource = typeof(IpaTranscriber).Assembly.GetManifestResourceStream(
            "EnglishLearning.Api.Resources.Pronunciation.en_US.txt.gz")
            ?? throw new InvalidOperationException("The bundled pronunciation dictionary is missing.");
        using var gzip = new GZipStream(resource, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8);
        var entries = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
        while (reader.ReadLine() is { } line)
        {
            var separator = line.IndexOf('\t');
            if (separator < 1) continue;
            var pronunciations = line[(separator + 1)..].Split(", ", StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                .Where(ipa => ipa.StartsWith('/') && ipa.EndsWith('/')).Distinct().ToArray();
            if (pronunciations.Length > 0) entries[line[..separator]] = pronunciations;
        }
        return entries.ToFrozenDictionary(StringComparer.OrdinalIgnoreCase);
    }

    [GeneratedRegex(@"['’]?[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*|\p{N}+(?:[.,]\p{N}+)*", RegexOptions.CultureInvariant)]
    private static partial Regex WordOrNumber();
    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
    [GeneratedRegex("[^\\p{L}\\p{M}\\p{N}\\s'’\"“”.,!?;:()\\[\\]{}\\-—–…]+")]
    private static partial Regex UnsupportedSymbols();
}
