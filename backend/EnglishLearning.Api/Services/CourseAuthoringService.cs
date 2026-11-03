using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

public sealed class AuthoringException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

public sealed class CourseAuthoringService(EnglishLearningDbContext dbContext, IMediaStorage media, IpaTranscriber transcriber)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<AdminCourseListResponse> ListAsync(AdminCourseQuery query, CancellationToken ct)
    {
        var courses = dbContext.Courses.AsNoTracking().Where(course => course.SourceType == "system");
        var search = query.Search?.Trim();
        if (!string.IsNullOrEmpty(search)) courses = courses.Where(course => course.Title.Contains(search));
        var count = await courses.CountAsync(ct);
        var items = await courses.OrderByDescending(course => course.UpdatedAt).ThenByDescending(course => course.CourseId)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(course => new AdminCourseListItem(course.CourseId, course.Title, course.CoverImageUrl, course.IsPublished,
                dbContext.Lessons.Count(lesson => lesson.CourseId == course.CourseId), course.UpdatedAt)).ToListAsync(ct);
        return new(items, count, query.Page, query.PageSize, (int)Math.Ceiling((double)count / query.PageSize));
    }

    public async Task<AdminCourseResponse> GetAsync(int id, CancellationToken ct)
    {
        var course = await CourseAsync(id, ct);
        var lessons = await dbContext.Lessons.AsNoTracking().Where(lesson => lesson.CourseId == id)
            .OrderBy(lesson => lesson.OrderIndex).ThenBy(lesson => lesson.LessonId).ToListAsync(ct);
        return new(course.CourseId, course.Title, course.Description, course.CoverImageUrl, course.IsPublished, course.UpdatedAt, lessons.Select(ToResponse).ToArray());
    }

    public async Task<AdminCourseResponse> CreateAsync(int adminId, CreateCourseRequest request, CancellationToken ct)
    {
        var course = new Course { Title = request.Title.Trim(), Description = request.Description?.Trim(),
            CoverImageUrl = EmptyToNull(request.CoverImageUrl), SourceType = "system", CreatedBy = adminId, IsPublished = false };
        dbContext.Courses.Add(course);
        await dbContext.SaveChangesAsync(ct);
        foreach (var (skill, index) in request.Skills.Select((skill, index) => (skill, index)))
            dbContext.Lessons.Add(new Lesson { CourseId = course.CourseId, Title = skill switch { "speaking" => "Bài học Speaking 1", "grammar" => "Bài học Grammar 1", "writing" => "Bài học Writing 1", "reading" => "Bài học Reading 1", _ => "Bài học Listening 1" },
                SkillType = skill, DifficultyLevel = request.DifficultyLevel, EstimatedMinutes = request.EstimatedMinutes, OrderIndex = index });
        await dbContext.SaveChangesAsync(ct);
        return await GetAsync(course.CourseId, ct);
    }

    public async Task<AdminCourseResponse> UpdateAsync(int id, SaveCourseRequest request, CancellationToken ct)
    {
        var course = await CourseAsync(id, ct);
        course.Title = request.Title.Trim(); course.Description = request.Description?.Trim(); course.CoverImageUrl = EmptyToNull(request.CoverImageUrl);
        if (course.IsPublished) await ValidateForPublicationAsync(course, (await GetAsync(id, ct)).Lessons, ct);
        await TouchAsync(course, ct);
        await dbContext.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task<AdminCourseResponse> SaveLessonAsync(int id, int? lessonId, SaveLessonRequest request, CancellationToken ct)
    {
        var course = await CourseAsync(id, ct);
        Lesson lesson;
        if (lessonId is { } existingId)
        {
            lesson = await dbContext.Lessons.SingleOrDefaultAsync(item => item.CourseId == id && item.LessonId == existingId, ct)
                ?? throw new AuthoringException(404, "Không tìm thấy bài học trong khóa học này.");
            if (lesson.SkillType != request.SkillType) throw new AuthoringException(400, "Không đổi kỹ năng của bài học đã tạo. Hãy thêm bài học mới.");
        }
        else
        {
            var order = await dbContext.Lessons.Where(item => item.CourseId == id).MaxAsync(item => (int?)item.OrderIndex, ct) ?? -1;
            lesson = new Lesson { CourseId = id, SkillType = request.SkillType, OrderIndex = order + 1 };
            dbContext.Lessons.Add(lesson);
        }
        lesson.Title = request.Title.Trim(); lesson.DifficultyLevel = request.DifficultyLevel;
        lesson.EstimatedMinutes = request.EstimatedMinutes; lesson.IsActive = request.IsActive; lesson.AudioUrl = EmptyToNull(request.AudioUrl);
        var speaking = request.Speaking is { } content ? new SpeakingContent
        {
            Goals = content.Goals,
            Sentences = content.Sentences.Select(sentence => new SpeakingSentence
            {
                Text = sentence.Text, AudioUrl = sentence.AudioUrl,
                Ipa = string.IsNullOrWhiteSpace(sentence.Ipa) ? transcriber.Transcribe(sentence.Text).Ipa : sentence.Ipa
            }).ToArray()
        } : null;
        lesson.Content = JsonSerializer.Serialize(new LessonContentDocument(1, speaking, request.Listening, request.Grammar, request.Writing, request.Reading), JsonOptions);
        if (course.IsPublished)
        {
            // Validate the candidate in memory before persisting any published changes.
            var saved = (await GetAsync(id, ct)).Lessons;
            var candidate = saved.Where(item => lessonId is null || item.LessonId != lessonId).Append(ToResponse(lesson)).ToArray();
            await ValidateForPublicationAsync(course, candidate, ct);
        }
        await TouchAsync(course, ct);
        await dbContext.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task<AdminCourseResponse> HideAsync(int id, CancellationToken ct)
    {
        var course = await CourseAsync(id, ct);
        if (course.IsPublished)
        {
            course.IsPublished = false;
            await TouchAsync(course, ct);
            await dbContext.SaveChangesAsync(ct);
        }
        return await GetAsync(id, ct);
    }

    public async Task<AdminCourseResponse> PublishAsync(int id, CancellationToken ct)
    {
        var course = await CourseAsync(id, ct);
        if (course.IsPublished) return await GetAsync(id, ct);
        await ValidateForPublicationAsync(course, (await GetAsync(id, ct)).Lessons, ct);
        course.IsPublished = true;
        await TouchAsync(course, ct);
        await dbContext.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    private async Task ValidateForPublicationAsync(Course course, IReadOnlyList<AdminLessonResponse> lessons, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct); deadline.CancelAfter(TimeSpan.FromSeconds(90));
        ct = deadline.Token;
        if (string.IsNullOrWhiteSpace(course.Description) || string.IsNullOrWhiteSpace(course.CoverImageUrl))
            throw new AuthoringException(400, "Bổ sung mô tả và ảnh bìa trước khi xuất bản.");
        var verified = new Dictionary<string, bool>(StringComparer.Ordinal);
        async Task<bool> ExistsAsync(string url, string type)
        {
            var key = type + url;
            if (!verified.TryGetValue(key, out var exists)) { exists = await media.ExistsAsync(url, type, ct); verified[key] = exists; }
            return exists;
        }
        if (!await ExistsAsync(course.CoverImageUrl, "image/")) throw new AuthoringException(400, "Không tìm thấy tệp ảnh bìa hợp lệ đã tải lên.");
        var active = lessons.Where(lesson => lesson.IsActive).ToArray();
        if (active.Length == 0) throw new AuthoringException(400, "Cần ít nhất một bài học được kích hoạt.");
        foreach (var lesson in active)
        {
            var audioValid = true;
            if (lesson.SkillType == "speaking" && lesson.Speaking?.Sentences is { } sentences)
                foreach (var sentence in sentences)
                    if (sentence.AudioUrl is not null && !await ExistsAsync(sentence.AudioUrl, "audio/")) { audioValid = false; break; }
            if (lesson.SkillType == "listening") audioValid = !string.IsNullOrWhiteSpace(lesson.AudioUrl) && await ExistsAsync(lesson.AudioUrl, "audio/");
            if (lesson.SkillType == "reading" && !string.IsNullOrWhiteSpace(lesson.Reading?.ImageUrl)
                && !await ExistsAsync(lesson.Reading.ImageUrl, "image/"))
                throw new AuthoringException(400, $"Ảnh minh họa của bài “{lesson.Title}” không tồn tại hoặc không phải tệp ảnh hợp lệ.");
            var valid = lesson.ContentSupported && lesson.DifficultyLevel is not null && lesson.EstimatedMinutes > 0 && (lesson.SkillType switch
            {
                "speaking" => lesson.Speaking?.Sentences is { Length: > 0 } && audioValid,
                "listening" => audioValid && !string.IsNullOrWhiteSpace(lesson.Listening?.Transcript) && lesson.Listening?.Questions is { Length: > 0 },
                "grammar" => lesson.Grammar is { Questions.Length: > 0 } grammar && !string.IsNullOrWhiteSpace(grammar.Topic) && !string.IsNullOrWhiteSpace(grammar.Rules),
                "writing" => lesson.Writing is { Rubric.Length: > 0 } writing && !string.IsNullOrWhiteSpace(writing.Prompt)
                    && writing.MinWords>=1 && writing.MaxWords>=writing.MinWords && writing.Rubric.Sum(item=>item.Weight)==100,
                "reading" => lesson.Reading is { Questions.Length: > 0 } reading && !string.IsNullOrWhiteSpace(reading.Passage),
                _ => false
            });
            if (!valid) throw new AuthoringException(400, $"Bài “{lesson.Title}” chưa đủ nội dung. Hãy hoàn thiện hoặc tắt kích hoạt.");
        }
    }

    private async Task<Course> CourseAsync(int id, CancellationToken ct) => await dbContext.Courses
        .SingleOrDefaultAsync(course => course.CourseId == id && course.SourceType == "system", ct)
        ?? throw new AuthoringException(404, "Không tìm thấy khóa học hệ thống.");
    private async Task TouchAsync(Course course, CancellationToken ct) => course.UpdatedAt =
        await dbContext.Database.SqlQuery<DateTime>($"SELECT SYSDATETIME() AS Value").SingleAsync(ct);
    private static string? EmptyToNull(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static AdminLessonResponse ToResponse(Lesson lesson)
    {
        LessonContentDocument? content = null;
        try { if (lesson.Content is not null) content = JsonSerializer.Deserialize<LessonContentDocument>(lesson.Content, JsonOptions); }
        catch (JsonException) { }
        var supported = lesson.Content is null || content is { Version: 1 };
        return new(lesson.LessonId, lesson.Title, lesson.SkillType, lesson.DifficultyLevel, lesson.EstimatedMinutes, lesson.OrderIndex,
            lesson.IsActive, lesson.AudioUrl, content?.Speaking, content?.Listening, supported, content?.Grammar, content?.Writing, content?.Reading);
    }
}
