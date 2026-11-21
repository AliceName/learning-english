using System.Text.RegularExpressions;
using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Services;

public static partial class WritingCardCandidates
{
    // A small, locally authored list of usage patterns. It carries no level or translation claims.
    private static readonly string[] Expressions = [
        "as a result", "as a result of", "draw a conclusion", "in addition to", "in front of", "in the long run",
        "keep a journal", "look forward to", "make an informed decision", "make progress", "manage time", "meet a deadline",
        "on the other hand", "pay attention to", "play a role in", "problem-solving skills", "raise awareness",
        "take into account", "take notes", "take responsibility for", "time management"
    ];
    // Leading verbs match their inflections, and one word may sit after the verb: "made good progress", "manage my time".
    private static readonly Dictionary<string, string[]> VerbForms = new(StringComparer.Ordinal)
    {
        ["draw"] = ["draw", "draws", "drawing", "drew", "drawn"], ["keep"] = ["keep", "keeps", "keeping", "kept"],
        ["look"] = ["look", "looks", "looking", "looked"], ["make"] = ["make", "makes", "making", "made"],
        ["manage"] = ["manage", "manages", "managing", "managed"], ["meet"] = ["meet", "meets", "meeting", "met"],
        ["pay"] = ["pay", "pays", "paying", "paid"], ["play"] = ["play", "plays", "playing", "played"],
        ["raise"] = ["raise", "raises", "raising", "raised"], ["take"] = ["take", "takes", "taking", "took", "taken"]
    };
    private static readonly (string Term, Regex Pattern)[] ExpressionPatterns = Expressions.Select(expression =>
    {
        var words = expression.Split(' ');
        var body = VerbForms.TryGetValue(words[0], out var forms)
            ? "(?:" + string.Join("|", forms) + @")(?:[ \t]+[\p{L}'’-]+)?[ \t]+" + string.Join(@"[ \t]+", words[1..].Select(Regex.Escape))
            : string.Join(@"[ \t]+", words.Select(Regex.Escape));
        return (expression, new Regex(@"(?<![\p{L}\p{M}\p{N}_'’-])" + body + @"(?![\p{L}\p{M}\p{N}_'’-])",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant));
    }).ToArray();

    /// <summary>Non-overlapping expression matches; the longer match wins ("as a result of" over "as a result").</summary>
    public static IEnumerable<(string Term, Match Match)> MatchExpressions(string text)
    {
        var kept = new List<(string Term, Match Match)>();
        foreach (var found in ExpressionPatterns.SelectMany(item => item.Pattern.Matches(text).Select(match => (item.Term, Match: match)))
                     .OrderByDescending(found => found.Match.Length).ThenBy(found => found.Match.Index))
            if (!kept.Any(other => found.Match.Index < other.Match.Index + other.Match.Length && other.Match.Index < found.Match.Index + found.Match.Length))
                kept.Add(found);
        return kept.OrderBy(found => found.Match.Index);
    }

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
                    // The edit span can carry the next word ("english" → "to English"); keep only a real preposition.
                    var preposition = explanation.Suggestion.Trim().Split(' ', 2)[0];
                    if (Prepositions.Contains(preposition.ToLowerInvariant())
                        && Collocation(suggestion.Suggestion, preposition) is { } pair)
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
            foreach (var (term, _) in MatchExpressions(suggestion.Suggestion))
                if (!MatchExpressions(suggestion.Original).Any(old => old.Term == term))
                    Add(term, suggestion.Original, "correction", "Ôn cụm từ xuất hiện trong đề xuất chỉnh sửa. Hãy kiểm tra ngữ cảnh trước khi lưu.", suggestion.Suggestion);
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
            foreach (var (term, match) in MatchExpressions(context))
                Add(term, context, "original", NormalizeTerm(match.Value) == term
                    ? "Ôn một cụm từ bạn đã dùng trong bài." : $"Ôn cụm “{term}” (trong bài bạn viết “{match.Value.Trim()}”).", context);
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
    private static readonly HashSet<string> Prepositions = ["about", "at", "by", "for", "from", "in", "into", "of", "on", "to", "with"];

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
