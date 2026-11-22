using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Services;

/// <summary>
/// Picks who corrects a Writing submission (<c>WritingAi:Provider</c>): <c>local</c> (default) uses the LEWA service for
/// everything; <c>api</c> keeps the local CEFR estimate and takes corrections from Gemini; <c>auto</c> does the same but
/// falls back to the local corrections when Gemini fails.
/// </summary>
public sealed class WritingAnalysisRouter(WritingAiClient local, WritingApiClient api, IConfiguration configuration,
    ILogger<WritingAnalysisRouter> logger)
{
    public const string ApiWarning = "Gợi ý sửa do AI bên ngoài (Gemini) đề xuất, có thể chưa chính xác.";
    public const string FallbackWarning = "AI bên ngoài chưa khả dụng, đã dùng bộ sửa của LEWA.";

    public string Mode => ReadMode(configuration);

    public static string ReadMode(IConfiguration settings) => settings["WritingAi:Provider"]?.Trim().ToLowerInvariant() switch
    {
        "api" => "api",
        "auto" => "auto",
        _ => "local",
    };

    public async Task<WritingAnalysis> AnalyzeAsync(SubmitWritingRequest request, CancellationToken ct)
    {
        var mode = Mode;
        if (mode == "local" || !request.Corrections) return await local.AnalyzeAsync(request, ct);

        // CEFR stays with the local model so both providers grade on the same scale.
        var cefr = await local.AnalyzeAsync(new SubmitWritingRequest { OriginalText = request.OriginalText, Corrections = false }, ct);
        WritingApiCorrection corrections;
        try { corrections = await api.CorrectAsync(request.OriginalText, cefr.Cefr, ct); }
        catch (WritingAiException error) when (mode == "auto" && !ct.IsCancellationRequested)
        {
            logger.LogWarning("Writing API unavailable ({Status}); falling back to local corrections.", error.StatusCode);
            var fallback = await local.AnalyzeAsync(request, ct);
            return fallback with { Warnings = [.. fallback.Warnings.Take(29), FallbackWarning] };
        }
        return cefr with
        {
            CorrectedText = corrections.CorrectedText,
            Errors = corrections.Errors,
            Warnings = [.. cefr.Warnings.Take(29), ApiWarning],
            GecCoverage = null,
            Upgrades = corrections.Upgrades,
            Provenance = (cefr.Provenance ?? new WritingProvenance()) with
            {
                GecRun = $"gemini:{corrections.Model}", GecAdapterSha256 = null,
                ExplanationVersion = WritingApiClient.TemplateVersion, GuardVersion = null, Provider = "gemini"
            }
        };
    }
}
