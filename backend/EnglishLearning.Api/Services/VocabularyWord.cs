using System.Text;
using System.Text.RegularExpressions;
using System.Globalization;

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

    public static bool IsDirection(string? direction) => direction is "en-en" or "en-vi" or "vi-en";
    public static string Language(string direction) => direction == "vi-en" ? "vi" : "en";
    public static string DefinitionLanguage(string direction) => direction == "en-vi" ? "vi" : "en";
    public static string Key(string normalizedWord, string direction) => $"{Language(direction)}:{normalizedWord}";

    public static bool TryNormalize(string? input, string direction, out string word)
    {
        if (direction == "en-en") return TryNormalize(input, out word);
        word = "";
        if (!IsDirection(direction) || string.IsNullOrWhiteSpace(input) || input.Length > 300 || input.Any(char.IsControl)) return false;
        try
        {
            word = Regex.Replace(input.Trim().Normalize(NormalizationForm.FormC).Replace('’', '\''), @"\s+", " ").ToLowerInvariant();
            if (word.Length is < 1 or > 100) return false;
            var needsLetter = true;
            foreach (var character in word)
            {
                var category = char.GetUnicodeCategory(character);
                if (char.IsLetter(character) && (character <= '\u024f' || character is >= '\u1e00' and <= '\u1eff')) needsLetter = false;
                else if (category == UnicodeCategory.NonSpacingMark && !needsLetter) continue;
                else if ((character is ' ' or '\'' or '-') && !needsLetter) needsLetter = true;
                else return false;
            }
            return !needsLetter;
        }
        catch (ArgumentException) { return false; }
    }

    [GeneratedRegex(@"\A[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F]+(?:['-][A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F]+)*\z", RegexOptions.CultureInvariant)]
    private static partial Regex Headword();
}
