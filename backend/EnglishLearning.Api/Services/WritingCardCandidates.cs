using System.Text.RegularExpressions;
using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Services;

public static partial class WritingCardCandidates
{
    // A small, locally authored list of usage patterns. It carries no level or translation claims.
    private static readonly string[] Expressions = [
        "as a result", "as a result of", "draw a conclusion", "in addition to", "in the long run",
        "keep a journal", "look forward to", "make an informed decision", "make progress", "meet a deadline",
        "on the other hand", "pay attention to", "play a role in", "raise awareness", "take into account",
        "take notes", "take responsibility for"
    ];
    private static readonly Regex ExpressionPattern = new(
        @"(?<![\p{L}\p{M}\p{N}_'’-])(?:" + string.Join("|", Expressions.OrderByDescending(value => value.Length)
            .Select(value => Regex.Escape(value).Replace(@"\ ", @"[ \t]+", StringComparison.Ordinal)))
        + @")(?![\p{L}\p{M}\p{N}_'’-])",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static WritingCardCandidate[] Find(string text, WritingSuggestion[] suggestions)
    {
        var candidates = new Dictionary<string, WritingCardCandidate>(StringComparer.Ordinal);
        foreach (var suggestion in suggestions)
        {
            if (suggestion?.SourceStart is null || !WritingAiClient.ValidSuggestion(suggestion, text)
                || suggestion.Suggestion == suggestion.Original) continue;
            foreach (var explanation in suggestion.Explanations ?? [])
            {
                if (explanation is not { Category: "SPELL", TemplateVersion: "vi-edit-templates-v1" }
                    || NormalizeTerm(explanation.Suggestion) == NormalizeTerm(explanation.Original)
                    || !ContainsTerm(suggestion.Original, explanation.Original)
                    || !ContainsTerm(suggestion.Suggestion, explanation.Suggestion)) continue;
                Add(explanation.Suggestion, suggestion.Original, "correction", "Ôn cách viết từ được đề xuất sửa.");
            }
            foreach (Match match in ExpressionPattern.Matches(suggestion.Suggestion))
            {
                var term = NormalizeTerm(match.Value);
                if (!ExpressionPattern.Matches(suggestion.Original).Any(old => NormalizeTerm(old.Value) == term))
                    Add(term, suggestion.Original, "correction", "Ôn cụm từ xuất hiện trong đề xuất chỉnh sửa. Hãy kiểm tra ngữ cảnh trước khi lưu.");
            }
        }
        var from = 0;
        foreach (Match boundary in SentenceBoundary().Matches(text))
        {
            AddExpressions(text[from..boundary.Index]);
            from = boundary.Index + boundary.Length;
        }
        AddExpressions(text[from..]);
        return candidates.Values.ToArray();

        void AddExpressions(string context)
        {
            foreach (Match match in ExpressionPattern.Matches(context))
                Add(match.Value, context, "original", "Ôn một cụm từ bạn đã dùng trong bài.");
        }

        void Add(string value, string context, string source, string reason)
        {
            if (!VocabularyWord.TryNormalize(value, "en-vi", out var term) || context.Trim().Length is < 1 or > 1000) return;
            candidates.TryAdd(term, new(term, context.Trim(), source, reason));
        }
    }

    public static string NormalizeTerm(string value) =>
        VocabularyWord.TryNormalize(value, "en-vi", out var term) ? term : value.Trim().ToLowerInvariant();

    private static bool ContainsTerm(string sentence, string term) =>
        VocabularyWord.TryNormalize(term, "en-vi", out var normalized) &&
        Regex.IsMatch(sentence.Replace('’', '\''), @"(?<![\p{L}\p{M}\p{N}_'-])" + Regex.Escape(normalized)
            + @"(?![\p{L}\p{M}\p{N}_'-])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    [GeneratedRegex(@"(?<=[.!?])[^\S\r\n]+|\r\n|[\r\n]", RegexOptions.CultureInvariant)]
    private static partial Regex SentenceBoundary();
}
