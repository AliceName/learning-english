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
                if (explanation is null || explanation.TemplateVersion is not (V1 or V2)) continue;
                // Missing or replaced preposition (v2): the learner keeps the verb/adjective + preposition pair.
                if (explanation is { Category: "PREP", TemplateVersion: V2 } && explanation.Suggestion.Trim().Length > 0)
                {
                    if (Collocation(suggestion.Suggestion, explanation.Suggestion) is { } pair)
                        Add(pair, suggestion.Original, "correction", "Ôn cụm từ đi với giới từ mà AI đề xuất. Hãy kiểm tra ngữ cảnh trước khi lưu.", suggestion.Suggestion);
                    continue;
                }
                var spelling = explanation.Category == "SPELL";
                if (!(spelling || (explanation.TemplateVersion == V2 && WordChoice.Contains(explanation.Category)))
                    || explanation.Original.Trim().Length == 0
                    || NormalizeTerm(explanation.Suggestion) == NormalizeTerm(explanation.Original)
                    || !ContainsTerm(suggestion.Original, explanation.Original)
                    || !ContainsTerm(suggestion.Suggestion, explanation.Suggestion)) continue;
                Add(explanation.Suggestion, suggestion.Original, "correction", spelling
                    ? "Ôn cách viết từ được đề xuất sửa."
                    : $"Từ AI đề xuất thay cho “{explanation.Original.Trim()}”. Hãy kiểm tra nghĩa trong ngữ cảnh trước khi lưu.", suggestion.Suggestion);
            }
            foreach (Match match in ExpressionPattern.Matches(suggestion.Suggestion))
            {
                var term = NormalizeTerm(match.Value);
                if (!ExpressionPattern.Matches(suggestion.Original).Any(old => NormalizeTerm(old.Value) == term))
                    Add(term, suggestion.Original, "correction", "Ôn cụm từ xuất hiện trong đề xuất chỉnh sửa. Hãy kiểm tra ngữ cảnh trước khi lưu.", suggestion.Suggestion);
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
                Add(match.Value, context, "original", "Ôn một cụm từ bạn đã dùng trong bài.", context);
        }

        void Add(string value, string context, string source, string reason, string? example = null)
        {
            if (!VocabularyWord.TryNormalize(value, "en-vi", out var term) || context.Trim().Length is < 1 or > 1000) return;
            var sentence = example?.Trim();
            candidates.TryAdd(term, new(term, context.Trim(), source, reason, Example: sentence is { Length: > 0 and <= 1000 } ? sentence : null));
        }
    }

    private const string V1 = "vi-edit-templates-v1", V2 = "vi-edit-templates-v2";
    // ERRANT word-choice kinds; grammar-only kinds (tense, agreement, form) do not make vocabulary cards.
    private static readonly HashSet<string> WordChoice = ["VERB", "NOUN", "ADJ", "ADV"];

    /// <summary>"listen to" from "I listen to music.": the word before the suggested preposition plus it.</summary>
    private static string? Collocation(string sentence, string preposition)
    {
        var match = Regex.Match(sentence.Replace('’', '\''), @"(\p{L}[\p{L}'-]*)[ \t]+(" + Regex.Escape(preposition.Trim())
            + @")(?![\p{L}\p{M}\p{N}_'-])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        return match.Success ? $"{match.Groups[1].Value} {match.Groups[2].Value}" : null;
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
