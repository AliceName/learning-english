using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Services;

public sealed class WritingAiException(string message, int statusCode = 503) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

public sealed class WritingAiClient(HttpClient http)
{
    private static readonly JsonSerializerOptions FeedbackJsonOptions = new(JsonSerializerDefaults.Web)
        { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };

    public async Task<WritingCapabilities> CapabilitiesAsync(CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(4));
        try
        {
            using var response = await http.GetAsync("internal/writing/capabilities", deadline.Token);
            if (!response.IsSuccessStatusCode) return UnavailableCapabilities();
            var value = await response.Content.ReadFromJsonAsync<WritingCapabilities>(FeedbackJsonOptions, deadline.Token);
            return value is { Status: "ready", CefrLimit: > 0 and <= 12000, GecSentenceLimit: 20 }
                && value.FeedbackStatus is "enabled" or "disabled" or "unavailable"
                && value.FeedbackEnabled == (value.FeedbackStatus == "enabled")
                && (value.CorrectionsEnabled ? value.GecInputLimit is > 0 and <= 12000 : value.GecInputLimit is null)
                ? value : UnavailableCapabilities();
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return UnavailableCapabilities(); }
        catch (Exception error) when (error is HttpRequestException or JsonException or NotSupportedException)
        { return UnavailableCapabilities(); }
    }

    public static WritingCapabilities UnavailableCapabilities() => new("unavailable", false, false, "unavailable", null, null, null, false);

    public async Task<WritingPreflight> PreflightAsync(WritingPreflightRequest request, CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(8));
        try
        {
            using var response = await http.PostAsJsonAsync("internal/writing/preflight",
                new { text = request.OriginalText, corrections = request.Corrections }, deadline.Token);
            if (!response.IsSuccessStatusCode) throw new WritingAiException("Chưa kiểm tra được giới hạn bài viết. Hãy thử lại sau.");
            var value = await response.Content.ReadFromJsonAsync<WritingPreflight>(FeedbackJsonOptions, deadline.Token);
            if (!ValidPreflight(value, request)) throw new WritingAiException("Kết quả kiểm tra giới hạn chưa hợp lệ.");
            return value!;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        { throw new WritingAiException("Kiểm tra giới hạn hết thời gian. Bản nháp vẫn được giữ."); }
        catch (Exception error) when (error is HttpRequestException or JsonException or NotSupportedException)
        { throw new WritingAiException("Chưa kiểm tra được giới hạn bài viết. Hãy thử lại sau."); }
    }

    private static bool ValidPreflight(WritingPreflight? value, WritingPreflightRequest request)
    {
        if (value is null || value.CefrTokens is < 1 or > 100000 || value.CefrLimit is < 1 or > 12000
            || value.CanAnalyze != (value.CefrTokens <= value.CefrLimit) || value.GecSentenceLimit != 20
            || value.Sentences is null || value.Sentences.Length > 12000
            || !ValidInputAssessment(value.InputAssessment)
            || (value.CorrectionsEnabled ? value.GecInputLimit is not (> 0 and <= 12000) : value.GecInputLimit is not null)
            || ((!request.Corrections || !value.CorrectionsEnabled) && value.Sentences.Length != 0)) return false;
        var previousEnd = 0;
        for (var index = 0; index < value.Sentences.Length; index++)
        {
            var sentence = value.Sentences[index];
            if (sentence is null || sentence.Index != index || sentence.Start < previousEnd || sentence.End <= sentence.Start
                || sentence.End > request.OriginalText.Length || sentence.Tokens is < 1 or > 100000
                || !Utf16Boundary(request.OriginalText, sentence.Start) || !Utf16Boundary(request.OriginalText, sentence.End)
                || string.IsNullOrWhiteSpace(request.OriginalText[sentence.Start..sentence.End])) return false;
            var expectedStatus = index >= value.GecSentenceLimit ? "sentenceLimit"
                : sentence.Tokens > value.GecInputLimit ? "inputOverBudget" : "ready";
            if (sentence.Status != expectedStatus) return false;
            previousEnd = sentence.End;
        }
        return true;
    }

    private static bool Utf16Boundary(string text, int index) => index >= 0 && index <= text.Length
        && (index == 0 || index == text.Length || !char.IsHighSurrogate(text[index - 1]) || !char.IsLowSurrogate(text[index]));

    private static bool ValidInputAssessment(WritingInputAssessment? value) => value is null ||
        (value.PolicyVersion == "cefr-input-v1" && value.Reasons is { Length: <= 3 }
         && value.Warnings is { Length: <= 5 } && value.Warnings.All(w => w is { Length: > 0 and <= 1000 })
         && value.Reasons.All(r => r is "tooShort" or "repetition" or "unsupportedScript")
         && value.Reasons.Distinct().Count() == value.Reasons.Length
         && value.Status == (value.Reasons.Length > 0 ? "insufficient" : "eligible"));

    public async Task<WritingAnalysis> AnalyzeAsync(SubmitWritingRequest request, CancellationToken cancellationToken)
    {
        using var response = await http.PostAsJsonAsync("internal/writing/analyze",
            new { text = request.OriginalText, corrections = request.Corrections }, cancellationToken);
        if (response.StatusCode == HttpStatusCode.UnprocessableEntity)
        {
            var message = "Bài chưa đủ điều kiện chấm CEFR hoặc vượt giới hạn mô hình. Hãy kiểm tra lại nội dung.";
            try
            {
                using var error = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
                if (error.RootElement.TryGetProperty("detail", out var detail) && detail.ValueKind == JsonValueKind.String
                    && detail.GetString() is { Length: > 0 and <= 1000 } description) message = description;
            }
            catch (JsonException) { }
            throw new WritingAiException(message, 422);
        }
        if (response.StatusCode == HttpStatusCode.TooManyRequests)
            throw new WritingAiException("AI đang xử lý bài khác. Hãy chờ một chút rồi nộp lại; bài viết vẫn được giữ.", 429);
        if (!response.IsSuccessStatusCode)
            throw new WritingAiException("AI đang bận hoặc chưa sẵn sàng. Vui lòng thử lại sau.");
        WritingAnalysis? result;
        try
        {
            result = await response.Content.ReadFromJsonAsync<WritingAnalysis>(cancellationToken);
        }
        catch (JsonException)
        {
            throw new WritingAiException("AI trả về kết quả chưa hợp lệ.");
        }
        if (result is null || result.Cefr is not ("A1" or "A2" or "B1" or "B2" or "C1" or "C2")
            || result.Errors is null || result.Warnings is null || result.CorrectedText?.Length > 24000
            || result.Errors.Length > 200 || result.Warnings.Length > 30
            || result.Errors.Any(e => !ValidSuggestion(e, request.OriginalText))
            || result.Warnings.Any(w => w is null || w.Length > 2000)
            || !ValidProvenance(result.Provenance) || result.Feedback is not null
            || !ValidCoverage(result.GecCoverage, result, request.Corrections))
            throw new WritingAiException("AI trả về kết quả chưa hợp lệ.");
        return result;
    }

    public async Task<WritingFeedback> FeedbackAsync(string text, string? topic, WritingSuggestion[] errors,
        CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(28));
        try
        {
            using var response = await http.PostAsJsonAsync("internal/writing/feedback",
                new { text, topic, errors = errors.Select(item => new
                    { item.Original, item.Suggestion, item.Explanations }).ToArray() }, deadline.Token);
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
                throw new WritingAiException("Phần nhận xét đang xử lý bài khác. Hãy thử lại sau.", 429);
            if (!response.IsSuccessStatusCode) return UnavailableFeedback();
            var result = await response.Content.ReadFromJsonAsync<WritingFeedback>(FeedbackJsonOptions, deadline.Token);
            return ValidFeedback(result, text, topic, errors) ? result! : UnavailableFeedback();
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return UnavailableFeedback("Phần nhận xét đã hết thời gian xử lý. Kết quả chấm và bài đã lưu vẫn được giữ.");
        }
        catch (Exception error) when (error is HttpRequestException or JsonException or NotSupportedException)
        {
            return UnavailableFeedback();
        }
    }

    public static WritingFeedback UnavailableFeedback(string? message = null) =>
        new("unavailable", [], message ?? "Phần nhận xét chưa khả dụng. Bài viết và kết quả chấm đã lưu vẫn được giữ.");

    private static bool Bounded(string? value, int max, bool required = false) =>
        value is null ? !required : value.Length <= max && (!required || !string.IsNullOrWhiteSpace(value));

    private static bool ValidHash(string? hash) => hash is null ||
        (hash.Length == 64 && hash.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f'));

    private static bool ValidProvenance(WritingProvenance? provenance) => provenance is null ||
        (Bounded(provenance.CefrRun, 120) && Bounded(provenance.GecRun, 120)
         && ValidHash(provenance.CefrAdapterSha256) && ValidHash(provenance.GecAdapterSha256)
         && Bounded(provenance.ExplanationVersion, 80) && Bounded(provenance.GuardVersion, 80)
         && Bounded(provenance.InputPolicyVersion, 80));

    private static bool ValidCoverage(WritingGecCoverage? coverage, WritingAnalysis result, bool corrections)
    {
        if (coverage is null) return true; // Older services and stored analyses omit this optional field.
        var counts = new[] { coverage.Changed, coverage.Unchanged, coverage.Rejected,
            coverage.InputOverBudget, coverage.Incomplete, coverage.SentenceLimit };
        return corrections && result.CorrectedText is not null
            && coverage.TotalBodySentences is >= 0 and <= 12000 && counts.All(n => n >= 0)
            && counts.Sum(n => (long)n) == coverage.TotalBodySentences
            && coverage.SentenceLimit == Math.Max(0, coverage.TotalBodySentences - 20)
            && coverage.Changed == result.Errors.Length;
    }

    internal static bool ValidSuggestion(WritingSuggestion? suggestion, string text) => suggestion is not null
        && Bounded(suggestion.Original, 12000, true) && Bounded(suggestion.Suggestion, 24000, true)
        && text.Contains(suggestion.Original, StringComparison.Ordinal)
        && ((suggestion.SourceStart is null && suggestion.SourceEnd is null)
            || (suggestion.SourceStart is int start && suggestion.SourceEnd is int end && start >= 0 && end > start
                && end <= text.Length && Utf16Boundary(text, start) && Utf16Boundary(text, end)
                && text[start..end] == suggestion.Original))
        && (suggestion.Explanations is null || (suggestion.Explanations.Length <= 40
            && suggestion.Explanations.All(e => e is not null && Bounded(e.Category, 80, true)
                && Bounded(e.Original, 12000) && e.Original is not null
                && Bounded(e.Suggestion, 24000) && e.Suggestion is not null
                && suggestion.Original.Contains(e.Original, StringComparison.Ordinal)
                && suggestion.Suggestion.Contains(e.Suggestion, StringComparison.Ordinal)
                && Bounded(e.Message, 2000, true) && Bounded(e.TemplateVersion, 80, true))));

    private static bool ValidFeedback(WritingFeedback? feedback, string text, string? topic, WritingSuggestion[] errors)
    {
        if (feedback is null || feedback.Status is not ("ready" or "unavailable")
            || feedback.Items is null || feedback.Items.Length > 4
            || !Bounded(feedback.Message, 2000, true) || !Bounded(feedback.ModelId, 200)
            || !ValidHash(feedback.ModelSha256) || !Bounded(feedback.PromptVersion, 80)) return false;
        if (feedback.Status == "unavailable") return feedback.Items.Length == 0;
        if (feedback.Items.Length == 0 || !Bounded(feedback.ModelId, 200, true)
            || feedback.ModelSha256 is null || !Bounded(feedback.PromptVersion, 80, true)) return false;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in feedback.Items)
        {
            if (item is null || item.Criterion is not ("content" or "organization" or "vocabulary" or "grammar")
                || !seen.Add(item.Criterion) || !Bounded(item.Quote, 500, true)
                || !text.Contains(item.Quote, StringComparison.Ordinal)
                || !Bounded(item.Comment, 1000, true) || !Bounded(item.Action, 1000, true)
                || (item.Criterion == "content" && string.IsNullOrWhiteSpace(topic))) return false;
            if (item.Criterion == "grammar")
            {
                if (item.SuggestionIndex is not int index || index < 0 || index >= errors.Length
                    || !errors[index].Original.Contains(item.Quote, StringComparison.Ordinal)) return false;
            }
            else if (item.SuggestionIndex is not null) return false;
        }
        return true;
    }
}
