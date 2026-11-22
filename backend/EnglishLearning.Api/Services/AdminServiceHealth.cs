using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services.AiCourses;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;

namespace EnglishLearning.Api.Services;

/// <summary>
/// Checks the services LEWA depends on for the admin overview. Local services are called with a short timeout;
/// outside AI providers are never called (it costs quota and sends data out), only reported as configured or not.
/// Results are cached for 30 seconds so reloading the page does not keep probing.
/// </summary>
public sealed class AdminServiceHealth(IServiceScopeFactory scopes, IHttpClientFactory http, IConfiguration configuration,
    IOptions<TranslationAiOptions> translation, MediaRuntimeState media, TimeProvider time, ILogger<AdminServiceHealth> logger)
{
    public const string SpeakingClient = "admin-speaking-health";
    public static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(30);
    public static readonly TimeSpan MinimumRefresh = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(3);
    private readonly SemaphoreSlim gate = new(1, 1);
    private AdminServiceReport? cached;

    public async Task<AdminServiceReport> GetAsync(bool refresh, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            var now = time.GetUtcNow();
            var age = cached is null ? TimeSpan.MaxValue : now - cached.CheckedAt;
            if (age < (refresh ? MinimumRefresh : CacheFor)) return cached!;
            using var scope = scopes.CreateScope();
            var checks = await Task.WhenAll(
                CheckAsync("database", "SQL Server", () => DatabaseAsync(scope.ServiceProvider, ct)),
                CheckAsync("mongodb", "MongoDB (từ điển)", () => MongoAsync(scope.ServiceProvider, ct)),
                CheckAsync("writing_ai", "Writing AI", () => WritingAsync(scope.ServiceProvider, ct)),
                CheckAsync("speaking_ai", "Speaking AI", () => SpeakingAsync(ct)));
            // A caller that went away must not leave "down" results in the cache.
            ct.ThrowIfCancellationRequested();
            cached = new(now, [.. checks, WritingApi(), CourseAi(), TranslationAi(), Media()]);
            return cached;
        }
        finally { gate.Release(); }
    }

    private async Task<AdminServiceStatus> CheckAsync(string key, string name, Func<Task<(bool Ok, string Detail)>> check)
    {
        var watch = Stopwatch.StartNew();
        try
        {
            var (ok, detail) = await check();
            return new(key, name, ok ? "ok" : "down", (int)watch.ElapsedMilliseconds, detail);
        }
        catch (Exception error) when (error is not OutOfMemoryException)
        {
            logger.LogWarning(error, "Health check for {Service} failed.", key);
            return new(key, name, "down", (int)watch.ElapsedMilliseconds,
                error is OperationCanceledException or TimeoutException ? "Không phản hồi kịp (quá thời gian chờ)." : "Không kết nối được.");
        }
    }

    private static async Task<(bool, string)> DatabaseAsync(IServiceProvider services, CancellationToken ct)
    {
        using var deadline = Deadline(ct);
        var ok = await services.GetRequiredService<EnglishLearningDbContext>().Database.CanConnectAsync(deadline.Token);
        return (ok, ok ? "Kết nối được." : "Không kết nối được.");
    }

    private static async Task<(bool, string)> MongoAsync(IServiceProvider services, CancellationToken ct)
    {
        using var deadline = Deadline(ct);
        await services.GetRequiredService<IMongoDatabase>().RunCommandAsync<BsonDocument>(new BsonDocument("ping", 1), cancellationToken: deadline.Token);
        return (true, "Kết nối được.");
    }

    private static async Task<(bool, string)> WritingAsync(IServiceProvider services, CancellationToken ct)
    {
        var value = await services.GetRequiredService<WritingAiClient>().CapabilitiesAsync(ct);
        if (value.Status != "ready") return (false, "Không kết nối được hoặc chưa nạp xong model.");
        static string OnOff(bool? on) => on switch { true => "bật", false => "tắt", null => "không rõ" };
        return (true, $"Sửa lỗi: {OnOff(value.CorrectionsEnabled)} · Nhận xét: {OnOff(value.FeedbackEnabled)} · Kiểm tra lạc đề: {OnOff(value.RelevanceEnabled)}"
            + (value.Busy ? " · đang bận" : ""));
    }

    private async Task<(bool, string)> SpeakingAsync(CancellationToken ct)
    {
        var baseUrl = (configuration["SpeakingAi:BaseUrl"] ?? "http://127.0.0.1:8001").TrimEnd('/');
        // The deployed scorer can take several seconds to wake from a cold start.
        using var deadline = Deadline(ct, TimeSpan.FromSeconds(8));
        using var request = new HttpRequestMessage(HttpMethod.Get, baseUrl + "/health");
        if (configuration["SpeakingAi:ApiToken"] is { Length: > 0 } token) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await http.CreateClient(SpeakingClient).SendAsync(request, deadline.Token);
        if (!response.IsSuccessStatusCode) return (false, $"Trả về HTTP {(int)response.StatusCode}.");
        using var body = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(deadline.Token), cancellationToken: deadline.Token);
        var status = body.RootElement.ValueKind == JsonValueKind.Object && body.RootElement.TryGetProperty("status", out var value) ? value.GetString() : null;
        // Only the host is shown, never the token; /health sends no learner audio.
        var host = Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri) ? uri.Host : baseUrl;
        return status == "ready" ? (true, $"Sẵn sàng chấm phát âm ({host}).") : (false, $"{host} chạy nhưng chưa sẵn sàng (đang nạp model?).");
    }

    private AdminServiceStatus CourseAi() => GeminiCourseClient.IsConfigured(configuration)
        ? new("course_ai", "AI tạo khóa học", "configured", null, "Đã có key; không gọi thử để tránh tốn lượt. Xem lượt gọi ở trang Quản lý API AI.")
        : new("course_ai", "AI tạo khóa học", "unconfigured", null, "Chưa cấu hình key nên học viên không tạo khóa học AI được.");

    private AdminServiceStatus WritingApi()
    {
        var use = WritingAnalysisRouter.ReadMode(configuration) switch
        {
            "api" => "Đang dùng để sửa lỗi Writing.",
            "auto" => "Đang dùng để sửa lỗi Writing; lỗi thì chuyển về bộ sửa của LEWA.",
            _ => "Đang tắt (WritingAi:Provider = local), Writing dùng bộ sửa của LEWA.",
        };
        return WritingApiClient.IsConfigured(configuration)
            ? new("writing_api", "AI sửa bài viết (Gemini)", "configured", null, $"Đã có key; không gọi thử. {use}")
            : new("writing_api", "AI sửa bài viết (Gemini)", "unconfigured", null, $"Chưa cấu hình key. {use}");
    }

    private AdminServiceStatus TranslationAi() => !string.IsNullOrWhiteSpace(translation.Value.ApiKey)
        ? new("translation_ai", "AI chấm phiên dịch", "configured", null, "Đã có key; không gọi thử để tránh tốn lượt.")
        : new("translation_ai", "AI chấm phiên dịch", "unconfigured", null, "Chưa cấu hình key; chỉ chấm được bằng đáp án có sẵn.");

    private AdminServiceStatus Media()
    {
        var mode = media.Status().Mode;
        return mode == "unconfigured"
            ? new("media", "Lưu trữ media", "unconfigured", null, "Chưa bật Cloudinary.")
            : new("media", "Lưu trữ media", "configured", null, mode switch
            {
                "cloud-only" => "Cloudinary.",
                "cloud-with-legacy-read" => "Cloudinary, vẫn đọc được file cũ trên máy chủ.",
                "legacy-read-only" => "Chỉ đọc file cũ trên máy chủ, không tải lên mới được.",
                _ => mode,
            });
    }

    private static CancellationTokenSource Deadline(CancellationToken ct, TimeSpan? limit = null)
    {
        var source = CancellationTokenSource.CreateLinkedTokenSource(ct);
        source.CancelAfter(limit ?? Timeout);
        return source;
    }
}
