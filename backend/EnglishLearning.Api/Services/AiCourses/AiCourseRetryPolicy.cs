using System.Security.Cryptography;

namespace EnglishLearning.Api.Services.AiCourses;

public static class AiCourseRetryPolicy
{
    public const int MaxRetries = 3;

    public static bool TrySchedule(AiCourseJob job, AiCourseException failure, DateTimeOffset now)
    {
        job.NextAttemptAt = null;
        if (!failure.Retryable || failure.OperationId is not Guid operation) return false;
        if (job.RetryOperationId != operation) {
            job.RetryOperationId = operation;
            job.TransientRetryCount = 0;
        }
        if (job.TransientRetryCount >= MaxRetries) return false;
        job.TransientRetryCount++;
        var backoff = 5 * (1 << (job.TransientRetryCount - 1)) + RandomNumberGenerator.GetInt32(3);
        var seconds = Math.Max(backoff, Math.Clamp(failure.RetryAfter ?? 0, 0, 3600));
        job.NextAttemptAt = now.AddSeconds(seconds);
        job.ErrorCode = failure.Code;
        job.Error = $"Gemini tạm thời bận. Hệ thống sẽ tự thử lại ({job.TransientRetryCount}/{MaxRetries}); tiến độ đã được lưu.";
        return true;
    }

    public static void Clear(AiCourseJob job)
    {
        job.RetryOperationId = null;
        job.TransientRetryCount = 0;
        job.NextAttemptAt = null;
    }
}
