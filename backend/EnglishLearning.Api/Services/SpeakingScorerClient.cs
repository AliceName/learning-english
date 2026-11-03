using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Services;

public sealed class SpeakingException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}
public interface ISpeakingScorer
{
    Task<SpeakingAssessment> ScoreAsync(byte[] wav, string referenceText, CancellationToken ct);
}
public sealed class SpeakingScorerClient(HttpClient client) : ISpeakingScorer
{
    public async Task<SpeakingAssessment> ScoreAsync(byte[] wav, string referenceText, CancellationToken ct)
    {
        using var form = new MultipartFormDataContent();
        using var audio = new ByteArrayContent(wav);
        audio.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(audio, "file", "recording.wav"); form.Add(new StringContent(referenceText), "text");
        try
        {
            using var response = await client.PostAsync("score", form, ct);
            if (!response.IsSuccessStatusCode)
            {
                var status = (int)response.StatusCode;
                string? title = null;
                try { using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct)); title = problem.RootElement.TryGetProperty("title", out var value) ? value.GetString() : null; }
                catch (JsonException) { }
                if (status is 400 or 413 or 422 or 429)
                    throw new SpeakingException(status == 422 ? 400 : status, title is { Length: > 0 and <= 400 } ? title : "Bản ghi chưa phù hợp. Vui lòng ghi lại.");
                throw new SpeakingException(503, "Bộ chấm Speaking chưa sẵn sàng. Vui lòng thử lại sau.");
            }
            var result = await response.Content.ReadFromJsonAsync<SpeakingAssessment>(cancellationToken: ct);
            if (result is null || !IsValid(result, referenceText))
                throw new SpeakingException(502, "Bộ chấm trả về kết quả không hợp lệ. Vui lòng thử lại.");
            return result;
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        { throw new SpeakingException(504, "Bộ chấm phản hồi quá lâu. Vui lòng thử lại."); }
        catch (HttpRequestException)
        { throw new SpeakingException(503, "Không kết nối được bộ chấm Speaking. Vui lòng thử lại sau."); }
        catch (JsonException)
        { throw new SpeakingException(502, "Không đọc được kết quả từ bộ chấm Speaking."); }
    }

    public static bool IsValid(SpeakingAssessment result, string text)
    {
        var words = Regex.Matches(text.Replace('’', '\''), @"[A-Za-z]+(?:'[A-Za-z]+)*").Select(m => m.Value).ToArray();
        if (result.Status is not ("scored" or "partial") || string.IsNullOrWhiteSpace(result.ModelVersion) || result.ModelVersion.Length > 200
            || !double.IsFinite(result.DurationSeconds) || result.DurationSeconds is < .3 or > 12.03
            || !double.IsFinite(result.OverallScore) || result.OverallScore is < 0 or > 100
            || !double.IsFinite(result.Coverage) || result.Coverage is <= 0 or > 1
            || result.ReferenceTokenCount is < 1 or > 140 || result.Words is null || result.Words.Length != words.Length
            || result.Warnings is null || result.Warnings.Length > 10 || result.Warnings.Any(w => w is null || w.Length > 500)
            || string.IsNullOrWhiteSpace(result.Feedback) || result.Feedback.Length > 2000) return false;
        var scores = new List<double>();
        if (result.Interpretation is { } info && (string.IsNullOrWhiteSpace(info.CalibrationVersion) || info.CalibrationVersion.Length > 100
            || info.CalibrationMethod is not ("identity" or "affine" or "isotonic")
            || !double.IsFinite(info.PracticeThreshold) || info.PracticeThreshold is < .25 or > 1.95
            || !double.IsFinite(info.ReviewThreshold) || info.ReviewThreshold < info.PracticeThreshold || info.ReviewThreshold > 2
            || !double.IsFinite(info.MinimumCoverage) || info.MinimumCoverage is <= 0 or > 1
            || info.FeedbackMode is not ("normal" or "limited_coverage" or "record_again")
            || info.EvidenceScope != "speechocean762-supported-subset"
            || info.FeedbackMode == "normal" && result.Coverage < info.MinimumCoverage
            || info.FeedbackMode == "limited_coverage" && result.Coverage >= info.MinimumCoverage)) return false;
        for (var i = 0; i < words.Length; i++)
        {
            var word = result.Words[i];
            if (word is null || word.Index != i || !string.Equals(word.Text, words[i], StringComparison.OrdinalIgnoreCase)
                || word.Status is not ("scored" or "unsupported") || word.Phones is null || word.Phones.Length > 50) return false;
            foreach (var p in word.Phones)
            {
                if (p is null || string.IsNullOrWhiteSpace(p.Symbol) || p.Symbol.Length > 12 || string.IsNullOrWhiteSpace(p.SourcePhone) || p.SourcePhone.Length > 8
                    || !double.IsFinite(p.Score) || p.Score is < 0 or > 2 || !double.IsFinite(p.StartSeconds) || !double.IsFinite(p.EndSeconds)
                    || p.StartSeconds < 0 || p.EndSeconds < p.StartSeconds || p.EndSeconds > result.DurationSeconds + .01
                    || p.RawScore is { } raw && (!double.IsFinite(raw) || raw is < 0 or > 2)) return false;
                scores.Add(p.Score);
            }
            if (word.Status == "unsupported" && (word.Phones.Length != 0 || word.Score is not null)) return false;
            if (word.Status == "scored" && (word.Phones.Length == 0 || word.Score is null || !double.IsFinite(word.Score.Value)
                || Math.Abs(word.Score.Value - word.Phones.Average(p => p.Score)) > .001)) return false;
        }
        return scores.Count > 0 && scores.Count <= result.ReferenceTokenCount
            && Math.Abs(result.Coverage - (double)scores.Count / result.ReferenceTokenCount) < .00001
            && Math.Abs(result.OverallScore - scores.Average() * 50) < .02
            && (result.Status == "scored") == (scores.Count == result.ReferenceTokenCount);
    }
}
