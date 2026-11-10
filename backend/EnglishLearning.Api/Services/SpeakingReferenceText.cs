using System.Text.RegularExpressions;

namespace EnglishLearning.Api.Services;

internal static class SpeakingReferenceText
{
    internal static readonly Regex Words = new(@"[A-Za-z]+(?:['’][A-Za-z]+)*", RegexOptions.Compiled);
    private static readonly Regex UnsupportedCharacters = new(@"[^A-Za-z\s\u001c-\u001f'’.,!?;:\-""()]", RegexOptions.Compiled);

    // Match the limits enforced by backend/speaking-ai/engine.py.
    internal static string? GetError(string? text)
    {
        if (string.IsNullOrEmpty(text) || text.Length > 300 || UnsupportedCharacters.IsMatch(text))
            return "Câu mẫu cần là tiếng Anh, tối đa 300 ký tự. Hãy viết số thành chữ.";

        return Words.Count(text) is < 1 or > 35 ? "Câu mẫu cần có từ 1 đến 35 từ." : null;
    }
}
