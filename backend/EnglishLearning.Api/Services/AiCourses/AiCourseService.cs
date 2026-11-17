using System.ComponentModel.DataAnnotations;
using System.Data;
using System.Security.Cryptography;
using System.Text.Json;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services.AiCourses;

public sealed class AiCourseService(AiCourseStore store, EnglishLearningDbContext db,
    GeminiCourseClient gemini, IOptions<CloudinarySettings> cloudSettings)
{
    public const string CoverUrl = "/images/courses/ai-default.png";

    public async Task<AiCourseJob> CreateAsync(int userId, Guid id, IFormFile file, AiCourseConfig config, CancellationToken ct)
    {
        if (!gemini.Configured) throw new AiCourseException(503, "gemini_not_configured", "Quản trị viên cần cấu hình Gemini API.");
        if (!Validator.TryValidateObject(config, new ValidationContext(config), [], true))
            throw new AiCourseException(400, "invalid_config", "Kiểm tra mục tiêu, CEFR, số bài, số câu hỏi và giọng đọc.");
        if (config.Skills.Contains("listening") && !cloudSettings.Value.Enabled)
            throw new AiCourseException(503, "media_not_configured", "Quản trị viên cần bật kho media để lưu audio Listening.");
        if (file.Length is <= 0 or > AiCourseSource.MaxBytes)
            throw new AiCourseException(413, "invalid_file_size", "Chọn tài liệu tối đa 10 MB.");
        var fileType = Path.GetExtension(file.FileName).TrimStart('.').ToLowerInvariant();
        if (fileType is not ("pdf" or "docx"))
            throw new AiCourseException(415, "invalid_file_type", "Chọn PDF có văn bản hoặc DOCX.");
        config.Goal = config.Goal.Trim();
        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer, ct);
        if (buffer.Length != file.Length || buffer.Length > AiCourseSource.MaxBytes)
            throw new AiCourseException(413, "invalid_file_size", "Kích thước tài liệu chưa hợp lệ.");
        var bytes = buffer.ToArray();
        var fingerprint = Convert.ToHexString(SHA256.HashData(bytes)) + JsonSerializer.Serialize(config, AiCourseStore.Json);
        using var gate = await store.LockAsync(ct);
        var previous = store.Read<AiCourseJob>(store.JobFile(id));
        if (previous is not null)
        {
            if (previous.UserId != userId) throw Missing();
            if (previous.Fingerprint != fingerprint) throw new AiCourseException(409, "idempotency_conflict", "Mã yêu cầu đã được dùng cho dữ liệu khác.");
            return previous;
        }
        var now = DateTimeOffset.UtcNow;
        var mine = store.Jobs().Where(job => job.UserId == userId).ToArray();
        if (mine.Count(job => job.CreatedAt >= AiApiGateway.DayStart(now)) >= 3)
            throw new AiCourseException(429, "daily_course_limit", "Bản thử giới hạn ba yêu cầu tạo khóa mỗi ngày.");
        if (mine.Any(job => job.Status is "queued" or "planning" or "generating" or "generating_audio"))
            throw new AiCourseException(409, "generation_running", "Một khóa học đang được xử lý. Hãy tiếp tục lượt đó trước.");
        var source = AiCourseSource.Extract(bytes, fileType, ct);
        var job = new AiCourseJob {
            ProtocolVersion = 2, Status = "queued",
            Id = id, UserId = userId, Config = config, Fingerprint = fingerprint,
            FileType = fileType, OriginalFileName = Path.GetFileName(file.FileName)[..Math.Min(Path.GetFileName(file.FileName).Length, 255)],
            SourceText = source
        };
        Directory.CreateDirectory(store.JobDirectory(id));
        await File.WriteAllBytesAsync(Path.Combine(store.JobDirectory(id), "source." + fileType), bytes, ct);
        store.Write(store.JobFile(id), job);
        return job;
    }

    public async Task<AiCourseJob> UpdateOutlineAsync(Guid id, int userId, AiOutlineUpdate request, CancellationToken ct)
    {
        using var gate = await store.LockAsync(ct);
        var job = RequireOwned(id, userId);
        if (job.Status != "awaiting_outline" || job.Outline is null || request.Revision != job.OutlineRevision)
            throw Conflict();
        if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Length > 255 ||
            string.IsNullOrWhiteSpace(request.Description) || request.Description.Length > 10000 ||
            request.Lessons is null || request.Lessons.Length != job.Outline.Lessons.Length ||
            request.Lessons.Any(item => item is null) ||
            request.Lessons.Select(item => item.Id).Distinct().Count() != request.Lessons.Length ||
            request.Lessons.Any(item => !job.Outline.Lessons.Any(original => original.Id == item.Id) ||
                string.IsNullOrWhiteSpace(item.Title) || item.Title.Length > 255 ||
                string.IsNullOrWhiteSpace(item.Objective) || item.Objective.Length > 1000))
            throw new AiCourseException(400, "invalid_outline", "Kiểm tra tên, mô tả và mục tiêu từng bài.");
        job.Outline.Title = request.Title.Trim();
        job.Outline.Description = request.Description.Trim();
        job.Outline.Lessons = request.Lessons.Select(item => new AiOutlineLesson {
            Id = item.Id, Title = item.Title.Trim(), Objective = item.Objective.Trim(),
            SkillType = job.Outline.Lessons.Single(original => original.Id == item.Id).SkillType
        }).ToArray();
        job.OutlineRevision++;
        job.UpdatedAt = DateTimeOffset.UtcNow;
        store.Write(store.JobFile(id), job);
        return job;
    }

    public async Task<AiCourseJob> GenerateAsync(Guid id, int userId, int revision, CancellationToken ct)
    {
        using var gate = await store.LockAsync(ct);
        var job = RequireOwned(id, userId);
        if (revision != job.OutlineRevision || job.Outline is null) throw Conflict();
        if (job.Status is "generating" or "generating_audio" or "awaiting_review" or "completed") return job;
        if (job.Status != "awaiting_outline") throw Conflict();
        job.Status = "generating";
        job.Error = job.ErrorCode = null;
        job.UpdatedAt = DateTimeOffset.UtcNow;
        store.Write(store.JobFile(id), job);
        return job;
    }

    public async Task<AiCourseJob> RetryAsync(Guid id, int userId, CancellationToken ct)
    {
        using var gate = await store.LockAsync(ct);
        var job = RequireOwned(id, userId);
        if (job.Status != "failed") return job;
        AiCourseRetryPolicy.Clear(job);
        job.Status = job.Outline is null ? "queued" : "generating";
        job.Error = job.ErrorCode = null;
        job.NextAttemptAt = null;
        job.UpdatedAt = DateTimeOffset.UtcNow;
        store.Write(store.JobFile(id), job);
        return job;
    }

    public async Task<AiCourseJob> ActivateAsync(Guid id, int userId, int revision, CancellationToken ct)
    {
        using var gate = await store.LockAsync(ct);
        var job = RequireOwned(id, userId);
        if (job.Status == "completed" && job.CourseId is not null) return job;
        if (job.Status != "awaiting_review" || job.Outline is null || revision != job.OutlineRevision ||
            !AiCourseContent.MatchesSelection(job.Config, job.Outline.Lessons) || job.Outline.Lessons.Any(lesson => !lesson.IsComplete))
            throw Conflict();
        foreach (var lesson in job.Outline.Lessons) AiCourseContent.Validate(lesson, job.Config.QuestionsPerLesson);

        await using var transaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct) : null;
        if (db.Database.IsSqlServer())
        {
            var resource = "ai-course-activate:" + job.Id.ToString("N");
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                DECLARE @result int;
                EXEC @result = sys.sp_getapplock @Resource={resource}, @LockMode=N'Exclusive',
                    @LockOwner=N'Transaction', @LockTimeout=5000;
                IF @result < 0 THROW 51000, 'AI course activation lock failed', 1;
                """, ct);
        }
        var sourceUrl = "/api/v1/ai-course-generations/" + id + "/source";
        var existing = await db.UploadedDocuments.SingleOrDefaultAsync(document => document.UserId == userId && document.FileUrl == sourceUrl, ct);
        if (existing?.GeneratedCourseId is int existingId) job.CourseId = existingId;
        else
        {
            var course = new Course {
                Title = job.Outline.Title, Description = job.Outline.Description, CoverImageUrl = CoverUrl,
                SourceType = "user_upload", CreatedBy = userId, IsPublished = true
            };
            db.Courses.Add(course);
            await db.SaveChangesAsync(ct);
            foreach (var (item, index) in job.Outline.Lessons.Select((lesson, index) => (lesson, index)))
            {
                var lesson = new Lesson {
                    CourseId = course.CourseId, Title = item.Title, SkillType = item.SkillType,
                    DifficultyLevel = job.Config.DifficultyLevel, OrderIndex = index,
                    EstimatedMinutes = item.SkillType switch { "writing" => 20, "reading" => 15, "grammar" => 10, "speaking" => 8,
                        _ => Math.Max(5, (int)Math.Ceiling((item.AudioSeconds ?? 60) / 60) + item.Listening!.Questions.Length) },
                    AudioUrl = item.SkillType == "listening" ? "/api/media/" + item.AudioFileName : null, IsActive = true,
                    Content = JsonSerializer.Serialize(AiCourseContent.Document(item), AiCourseStore.Json)
                };
                if (item.SkillType == "listening") ListeningGradingService.ReadContent(lesson);
                if (item.SkillType == "grammar") GrammarGradingService.ReadContent(lesson);
                db.Lessons.Add(lesson);
            }
            db.UploadedDocuments.Add(new UploadedDocument {
                UserId = userId, OriginalFileName = job.OriginalFileName, FileType = job.FileType, FileUrl = sourceUrl,
                ExtractedText = job.SourceText, Summary = job.Outline.Summary, GeneratedCourseId = course.CourseId,
                Status = "completed", ProcessedAt = DateTime.Now
            });
            await db.SaveChangesAsync(ct);
            job.CourseId = course.CourseId;
        }
        if (transaction is not null) await transaction.CommitAsync(ct);
        job.Status = "completed";
        job.UpdatedAt = DateTimeOffset.UtcNow;
        store.Write(store.JobFile(id), job);
        return job;
    }

    private AiCourseJob RequireOwned(Guid id, int userId)
    {
        var job = store.Read<AiCourseJob>(store.JobFile(id));
        return job is not null && job.UserId == userId ? job : throw Missing();
    }
    private static AiCourseException Missing() => new(404, "generation_not_found", "Không tìm thấy lần tạo khóa học.");
    private static AiCourseException Conflict() => new(409, "generation_changed", "Trạng thái hoặc dàn ý đã thay đổi. Hãy tải lại lượt tạo.");
}
