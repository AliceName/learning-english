using System.Security.Cryptography;
using System.Text;
using EnglishLearning.Api.Services.CloudinaryMedia;
using EnglishLearning.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services.AiCourses;

public sealed class AiCourseWorker(IServiceScopeFactory scopes, AiCourseStore store, ILogger<AiCourseWorker> logger, IConfiguration configuration) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!(configuration.GetValue<bool?>("CourseGeneration:WorkerEnabled") ?? true)) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var worker = store.TryWorkerLock();
                if (worker is not null)
                {
                    AiCourseJob? job;
                    using (var gate = await store.LockAsync(stoppingToken))
                        job = store.Jobs().Where(item => item.Status is "queued" or "planning" or "generating" or "generating_audio")
                            .Where(item => item.NextAttemptAt is null || item.NextAttemptAt <= DateTimeOffset.UtcNow)
                            .OrderBy(item => item.CreatedAt).FirstOrDefault();
                    if (job is not null) await ProcessAsync(job, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception error) { logger.LogError(error, "AI course worker could not load its queue."); }
            try { await Task.Delay(1500, stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }

    private async Task ProcessAsync(AiCourseJob job, CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var gemini = scope.ServiceProvider.GetRequiredService<GeminiCourseClient>();
        try
        {
            var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
            if (!await db.Users.AnyAsync(user => user.UserId == job.UserId && user.IsActive, ct))
                throw new AiCourseException(403, "account_inactive", "Tài khoản tạo khóa học không còn hoạt động.");
            job.NextAttemptAt = null;
            job.Error = job.ErrorCode = null;
            if (job.Outline is null)
            {
                job.Status = "planning";
                await store.SaveJobAsync(job, ct);
                job.Outline = await gemini.PlanAsync(job, ct);
                job.OutlineRevision = 1;
                job.Status = "awaiting_outline";
                job.Error = job.ErrorCode = null;
                AiCourseRetryPolicy.Clear(job);
                await store.SaveJobAsync(job, ct);
                return;
            }
            foreach (var lesson in job.Outline.Lessons)
            {
                if (lesson.IsComplete) continue;
                if (!lesson.HasContent)
                {
                    job.Status = "generating";
                    await store.SaveJobAsync(job, ct);
                    await gemini.GenerateLessonAsync(job, lesson, ct);
                    if (lesson.Speaking is { } speaking)
                    {
                        var ipa = scope.ServiceProvider.GetRequiredService<IpaTranscriber>();
                        lesson.Speaking = new Contracts.SpeakingContent { Goals = speaking.Goals,
                            Sentences = speaking.Sentences.Select(sentence => new Contracts.SpeakingSentence {
                                Text = sentence.Text, Ipa = ipa.Transcribe(sentence.Text).Ipa
                            }).ToArray() };
                    }
                    await store.SaveJobAsync(job, ct);
                }
                if (lesson.SkillType != "listening") continue;
                var media = scope.ServiceProvider.GetRequiredService<ICloudMediaStore>();
                job.Status = "generating_audio";
                await store.SaveJobAsync(job, ct);
                var audioPath = Path.Combine(store.JobDirectory(job.Id), lesson.Id.ToString("N") + ".wav");
                if (!File.Exists(audioPath))
                {
                    var audio = await gemini.AudioAsync(job, lesson, ct);
                    var temporary = audioPath + ".tmp";
                    await File.WriteAllBytesAsync(temporary, audio.Bytes, ct);
                    File.Move(temporary, audioPath, overwrite: true);
                    lesson.AudioSeconds = audio.Seconds;
                    await store.SaveJobAsync(job, ct);
                }
                var bytes = await File.ReadAllBytesAsync(audioPath, ct);
                lesson.AudioSeconds = GeminiCourseClient.WavSeconds(bytes);
                _ = CloudMediaValidation.ValidateBytes(CloudMediaKind.CourseAudio, "wav", bytes);
                var reference = new Guid(SHA256.HashData(Encoding.UTF8.GetBytes($"{job.Id}/{lesson.Id}/audio"))[..16]).ToString("N");
                await store.RegisterPrivateMediaAsync(reference + ".wav", job.UserId, ct);
                await media.StoreAsync(CloudMediaKind.CourseAudio, reference, bytes, "wav", null, ct);
                lesson.AudioFileName = reference + ".wav";
                await store.SaveJobAsync(job, ct);
            }
            job.Status = "awaiting_review";
            job.Error = job.ErrorCode = null;
            AiCourseRetryPolicy.Clear(job);
            await store.SaveJobAsync(job, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception error)
        {
            if (error is AiCourseException ai)
            {
                job.ErrorCode = ai.Code;
                job.Error = ai.Message;
                if (ai.Retryable)
                {
                    if (!AiCourseRetryPolicy.TrySchedule(job, ai, DateTimeOffset.UtcNow))
                        job.Error = "Gemini vẫn chưa sẵn sàng sau các lần tự thử lại. Tiến độ đã được giữ; bạn có thể thử lại sau.";
                }
                // Waiting for local quota/cooldown does not consume another provider attempt.
                else if (ai.Status == 429 && ai.Code != "ai_paused")
                    job.NextAttemptAt = DateTimeOffset.UtcNow.AddSeconds(Math.Clamp(ai.RetryAfter ?? 60, 1, 86400));
            }
            else if (error is CloudMediaException)
            {
                job.ErrorCode = "audio_storage_unavailable";
                job.Error = "Audio đã được giữ lại nhưng chưa lưu được vào kho media. Hãy thử lại để tiếp tục tải lên.";
            }
            else
            {
                logger.LogError(error, "AI course {GenerationId} failed at {Stage}.", job.Id, job.Status);
                job.ErrorCode = "generation_failed";
                job.Error = "Chưa hoàn thành bước xử lý. Có thể thử lại từ dữ liệu đã lưu.";
            }
            job.Status = job.NextAttemptAt is not null ? job.Outline is null ? "queued" : "generating" : "failed";
            await store.SaveJobAsync(job, ct);
        }
    }
}
