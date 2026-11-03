using System.Text.RegularExpressions;
using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Services;

/// <summary>Deterministic practice chunks, not a linguistic or CEFR assessment.</summary>
public static class SpeakingPhraseSegmenter
{
    public const string Version = "phrase-v1";
    private static readonly Regex Words = new(@"[A-Za-z]+(?:['’][A-Za-z]+)*", RegexOptions.Compiled);
    private static readonly Regex Pause = new(@"[,;:.!?]|\s[-–—]\s", RegexOptions.Compiled);
    private static readonly HashSet<string> PhraseStarts = new(StringComparer.OrdinalIgnoreCase)
    {
        "in", "on", "at", "with", "without", "from", "for", "into", "over", "under", "after", "before",
        "through", "between", "about", "around", "against", "across", "until", "to", "of", "as",
        "and", "but", "or", "so", "because", "although", "while", "when", "where", "if", "unless", "which", "who"
    };
    private static readonly HashSet<string> KeepWithNext = new(PhraseStarts, StringComparer.OrdinalIgnoreCase)
    {
        "a", "an", "the", "my", "your", "his", "her", "our", "their", "this", "these", "those", "not"
    };

    public static SpeakingSegment[] Split(string text)
    {
        var words = Words.Matches(text);
        if (words.Count == 0) return [];
        if (words.Count <= 6) return [new(0, text.Trim(), 0, words.Count)];

        // For long sentences, every chunk has 3–6 words. Dynamic programming
        // avoids a one-word tail while preferring punctuation and phrase starts.
        var costs = Enumerable.Repeat(double.PositiveInfinity, words.Count + 1).ToArray();
        var previous = Enumerable.Repeat(-1, words.Count + 1).ToArray();
        costs[0] = 0;
        for (var end = 3; end <= words.Count; end++)
        {
            for (var length = 3; length <= 6 && length <= end; length++)
            {
                var start = end - length;
                if (!double.IsFinite(costs[start])) continue;
                var cost = costs[start] + 4 + .7 * Math.Pow(length - 4.5, 2);
                if (end < words.Count) cost -= BoundaryValue(text, words, end);
                if (cost >= costs[end]) continue;
                costs[end] = cost; previous[end] = start;
            }
        }
        var boundaries = new List<(int Start, int End)>();
        for (var end = words.Count; end > 0;)
        {
            var start = previous[end];
            if (start < 0) throw new InvalidOperationException("Unable to segment sentence without losing words.");
            boundaries.Add((start, end)); end = start;
        }
        boundaries.Reverse();
        return boundaries.Select((part, index) =>
        {
            var charStart = part.Start == 0 ? 0 : words[part.Start].Index;
            var charEnd = part.End == words.Count ? text.Length : words[part.End].Index;
            return new SpeakingSegment(index, text[charStart..charEnd].Trim(), part.Start, part.End - part.Start);
        }).ToArray();
    }

    private static double BoundaryValue(string text, MatchCollection words, int next)
    {
        var left = words[next - 1]; var right = words[next];
        var separator = text[(left.Index + left.Length)..right.Index];
        if (Pause.IsMatch(separator)) return 8;
        var score = PhraseStarts.Contains(right.Value) ? 4 : 0;
        if (KeepWithNext.Contains(left.Value)) score -= 5;
        // A hyphenated compound still contains separate scorer tokens, but
        // keep it in one practice chunk whenever the length budget allows.
        if (separator.Contains('-') && !separator.Any(char.IsWhiteSpace)) score -= 20;
        return score;
    }
}
