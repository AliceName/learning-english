using System.Text;
using System.Text.RegularExpressions;

namespace EnglishLearning.Api.Services;

public static partial class VocabularyWord
{
    public static bool TryNormalize(string? input, out string word)
    {
        word = "";
        if (string.IsNullOrWhiteSpace(input) || input.Length > 300) return false;
        try { word = input.Trim().Normalize(NormalizationForm.FormC).Replace('’', '\'').ToLowerInvariant(); }
        catch (ArgumentException) { return false; }
        // English headwords, including Latin diacritics, apostrophes and hyphenated words.
        return word.Length is > 0 and <= 100 && Headword().IsMatch(word);
    }

    public static string Key(string normalizedWord) => $"en:{normalizedWord}";

    [GeneratedRegex(@"\A[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F]+(?:['-][A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F]+)*\z", RegexOptions.CultureInvariant)]
    private static partial Regex Headword();
}
