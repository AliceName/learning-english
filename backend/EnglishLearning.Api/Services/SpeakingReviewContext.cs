using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Services;

/// <summary>Validates an optional source-sentence span for free pronunciation review.</summary>
public static class SpeakingReviewContext
{
    public static SpeakingAttemptScope? CreateScope(string text, string? sentenceText, int? startWordIndex)
    {
        if (SpeakingReferenceText.GetError(text) is { } textError) throw new SpeakingException(400, textError);
        if (sentenceText is null && startWordIndex is null) return null;
        if (sentenceText is null || startWordIndex is null)
            throw new SpeakingException(400, "Cần gửi cả câu gốc và vị trí từ khi luyện theo ngữ cảnh.");
        if (SpeakingReferenceText.GetError(sentenceText) is { } contextError) throw new SpeakingException(400, contextError);

        var words = SpeakingReferenceText.Words.Matches(text.Replace('’', '\'')).Select(match => match.Value).ToArray();
        var sourceWords = SpeakingReferenceText.Words.Matches(sentenceText.Replace('’', '\'')).Select(match => match.Value).ToArray();
        var start = startWordIndex.Value;
        if (start is < 0 or > 34 || start + words.Length > sourceWords.Length
            || !sourceWords.Skip(start).Take(words.Length).SequenceEqual(words, StringComparer.OrdinalIgnoreCase))
            throw new SpeakingException(400, "Phần luyện không khớp vị trí từ trong câu gốc. Hãy mở lại phần luyện.");

        // Used only to forward source text and offset to Python, never persisted
        // or represented as a course segment in the free-practice response.
        return new("segment", 0, start, words.Length, sentenceText, "free-review-v1");
    }
}
