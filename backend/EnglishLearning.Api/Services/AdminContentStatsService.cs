using System.Text.Json;
using System.Text.RegularExpressions;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

/// <summary>
/// Read-only content statistics for admins: per Writing library task and per course lesson. Only real learners
/// count (<see cref="AdminLearnerFilter"/>). Results contain counts and question numbers, never learner text or answers.
/// </summary>
public sealed partial class AdminContentStatsService(EnglishLearningDbContext db, AdminLearnerFilter filter,
    WritingTaskLibrary library, ILogger<AdminContentStatsService> logger)
{
    /// <summary>Newest submissions read for task statistics; enough for the pilot, revisit with an index at scale.</summary>
    public const int SubmissionLimit = 5000;
    public const decimal PassScore = 80m;

    [GeneratedRegex(@"[\p{L}\p{N}]+(?:['’][\p{L}]+)*")]
    private static partial Regex Word();

    private sealed record Essay(int Id, int UserId, string TaskId, string Title, string Genre, string Level, string Topic,
        int? RootId, DateTime CreatedAt, int Words, int Errors, string[] Categories, bool? OffTopic);

    public async Task<AdminWritingTaskReport> WritingTasksAsync(CancellationToken ct)
    {
        var learners = db.Users.AsNoTracking().Where(filter.RealLearner());
        var counted = await learners.CountAsync(ct);
        var excluded = await db.Users.CountAsync(ct) - counted;
        var learnerIds = learners.Select(user => user.UserId);
        var rows = await db.WritingSubmissions.AsNoTracking()
            .Where(item => learnerIds.Contains(item.UserId) && item.ErrorsJson != null && item.ErrorsJson.Contains("\"task\":{"))
            .OrderByDescending(item => item.SubmissionId).Take(SubmissionLimit)
            .Select(item => new { item.SubmissionId, item.UserId, item.OriginalText, item.ErrorsJson, item.CreatedAt })
            .ToListAsync(ct);
        var essays = rows.Select(row => Parse(row.SubmissionId, row.UserId, row.OriginalText, row.ErrorsJson!, row.CreatedAt))
            .OfType<Essay>().ToArray();

        WritingTaskSnapshot[] catalogue = [];
        try { catalogue = library.Load().Items; }
        catch (Exception error) when (error is IOException or InvalidDataException or InvalidOperationException or JsonException or UnauthorizedAccessException)
        { logger.LogInformation("Writing catalogue unavailable for admin statistics: {Reason}", error.GetType().Name); }

        var byTask = essays.GroupBy(essay => essay.TaskId).ToDictionary(group => group.Key, group => group.ToArray());
        var tasks = new List<AdminWritingTaskStats>();
        foreach (var task in catalogue)
            tasks.Add(Summarize(task.Id, task.Title, task.Genre, task.Level, task.Topic, true, byTask.GetValueOrDefault(task.Id) ?? []));
        // Tasks that left the catalogue still show, named from the snapshot stored with the essay.
        foreach (var (id, group) in byTask.Where(pair => catalogue.All(task => task.Id != pair.Key)))
        {
            var latest = group.MaxBy(essay => essay.Id)!;
            tasks.Add(Summarize(id, latest.Title, latest.Genre, latest.Level, latest.Topic, false, group));
        }
        var categories = Top(essays.Where(essay => essay.RootId is null).SelectMany(essay => essay.Categories), 12);
        return new(counted, excluded, rows.Count, catalogue.Length > 0,
            tasks.OrderByDescending(task => task.Learners).ThenByDescending(task => task.Rounds).ThenBy(task => task.Title, StringComparer.Ordinal).ToArray(),
            categories);
    }

    private static AdminWritingTaskStats Summarize(string id, string title, string genre, string level, string topic, bool inCatalogue, Essay[] group)
    {
        var first = group.Where(essay => essay.RootId is null).ToArray();
        var revisedRoots = group.Where(essay => essay.RootId is not null).Select(essay => essay.RootId!.Value).ToHashSet();
        var words = first.Sum(essay => essay.Words);
        var errors = first.Sum(essay => essay.Errors);
        var checkedRelevance = first.Where(essay => essay.OffTopic is not null).ToArray();
        return new(id, title, genre, level, topic, inCatalogue,
            group.Select(essay => essay.UserId).Distinct().Count(), first.Length, first.Count(essay => revisedRoots.Contains(essay.Id)),
            words, errors, words > 0 ? decimal.Round(errors * 100m / words, 1) : null,
            checkedRelevance.Length, checkedRelevance.Count(essay => essay.OffTopic == true),
            group.Length == 0 ? null : group.Max(essay => essay.CreatedAt), Top(first.SelectMany(essay => essay.Categories), 3));
    }

    private static AdminCategoryCount[] Top(IEnumerable<string> categories, int take) =>
        categories.GroupBy(category => category).Select(group => new AdminCategoryCount(group.Key, group.Count()))
            .OrderByDescending(item => item.Count).ThenBy(item => item.Category, StringComparer.Ordinal).Take(take).ToArray();

    private static Essay? Parse(int id, int userId, string text, string json, DateTime createdAt)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("task", out var task) || task.ValueKind != JsonValueKind.Object
                || String(task, "id") is not { } taskId || !Guid.TryParse(taskId, out _)) return null;
            int? rootId = root.TryGetProperty("practice", out var practice) && practice.ValueKind == JsonValueKind.Object
                && practice.TryGetProperty("rootSubmissionId", out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number) ? number : null;
            var categories = new List<string>();
            if (root.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Array)
                foreach (var sentence in errors.EnumerateArray())
                    if (sentence.ValueKind == JsonValueKind.Object && sentence.TryGetProperty("explanations", out var items) && items.ValueKind == JsonValueKind.Array)
                        foreach (var item in items.EnumerateArray())
                            categories.Add(item.ValueKind == JsonValueKind.Object && String(item, "category") is { Length: > 0 and <= 40 } category ? category : "OTHER");
            bool? offTopic = root.TryGetProperty("relevance", out var relevance) && relevance.ValueKind == JsonValueKind.Object
                && relevance.TryGetProperty("offTopic", out var flag) && flag.ValueKind is JsonValueKind.True or JsonValueKind.False ? flag.GetBoolean() : null;
            return new(id, userId, taskId, String(task, "title") ?? "(không rõ tên)", String(task, "genre") ?? "", String(task, "level") ?? "",
                String(task, "topic") ?? "", rootId, createdAt, Word().Count(text), categories.Count, [.. categories], offTopic);
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or FormatException) { return null; }
    }

    private static string? String(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    public async Task<AdminCourseStats?> CourseAsync(int courseId, CancellationToken ct)
    {
        var course = await db.Courses.AsNoTracking().SingleOrDefaultAsync(item => item.CourseId == courseId && item.SourceType == "system", ct);
        if (course is null) return null;
        var learnerIds = await db.Users.AsNoTracking().Where(filter.RealLearner()).Select(user => user.UserId).ToListAsync(ct);
        var lessons = await db.Lessons.AsNoTracking().Where(lesson => lesson.CourseId == courseId).OrderBy(lesson => lesson.OrderIndex).ToListAsync(ct);
        var lessonIds = lessons.Select(lesson => lesson.LessonId).ToArray();
        var enrolled = await db.UserCourses.AsNoTracking().Where(item => item.CourseId == courseId && learnerIds.Contains(item.UserId))
            .Select(item => item.UserId).Distinct().ToListAsync(ct);
        var results = await db.ExerciseResults.AsNoTracking().Where(item => lessonIds.Contains(item.LessonId) && learnerIds.Contains(item.UserId))
            .Select(item => new { item.LessonId, item.UserId, item.Score, item.TimeSpentSeconds, item.WrongAnswersJson }).ToListAsync(ct);
        var speaking = await db.SpeakingAttempts.AsNoTracking().Where(item => lessonIds.Contains(item.LessonId) && learnerIds.Contains(item.UserId))
            .Select(item => new { item.LessonId, item.UserId, item.OverallScore, item.DurationSeconds }).ToListAsync(ct);
        var writing = await db.WritingSubmissions.AsNoTracking().Where(item => item.LessonId != null && lessonIds.Contains(item.LessonId.Value) && learnerIds.Contains(item.UserId))
            .Select(item => new { LessonId = item.LessonId!.Value, item.UserId }).ToListAsync(ct);

        var stats = new List<AdminLessonStats>(lessons.Count);
        foreach (var lesson in lessons)
        {
            // (user, score, seconds) for whichever table this lesson's skill writes to.
            var attempts = lesson.SkillType switch
            {
                "speaking" => speaking.Where(item => item.LessonId == lesson.LessonId).Select(item => (item.UserId, item.OverallScore, item.DurationSeconds)).ToArray(),
                "writing" => writing.Where(item => item.LessonId == lesson.LessonId).Select(item => (item.UserId, (decimal?)null, (int?)null)).ToArray(),
                _ => results.Where(item => item.LessonId == lesson.LessonId).Select(item => (item.UserId, (decimal?)item.Score, item.TimeSpentSeconds)).ToArray(),
            };
            var scores = attempts.Where(item => item.Item2 is not null).Select(item => item.Item2!.Value).ToArray();
            var seconds = attempts.Where(item => item.Item3 is > 0).Select(item => item.Item3!.Value).ToArray();
            var users = attempts.Select(item => item.UserId).ToHashSet();
            var (current, missed) = lesson.SkillType is "reading" or "grammar" or "listening"
                ? MostMissed(lesson, results.Where(item => item.LessonId == lesson.LessonId).Select(item => item.WrongAnswersJson))
                : (0, []);
            stats.Add(new(lesson.LessonId, lesson.Title, lesson.SkillType, lesson.OrderIndex, lesson.IsActive,
                users.Count, attempts.Length,
                scores.Length > 0 ? decimal.Round(scores.Average(), 1) : null,
                seconds.Length > 0 ? (int)Math.Round(seconds.Average()) : null,
                scores.Length > 0 ? decimal.Round(scores.Count(score => score >= PassScore) * 100m / scores.Length, 0) : null,
                enrolled.Count(user => !users.Contains(user)), current, missed));
        }
        return new(course.CourseId, course.Title, course.IsPublished, enrolled.Count, stats);
    }

    /// <summary>Counts wrong answers per question, only for attempts on the lesson's current content.</summary>
    private static (int Attempts, AdminMissedQuestion[] Missed) MostMissed(Lesson lesson, IEnumerable<string?> documents)
    {
        var version = lesson.SkillType == "grammar" ? GrammarGradingService.ContentVersion(lesson) : ListeningGradingService.ContentVersion(lesson);
        var attempts = 0;
        var misses = new Dictionary<int, (string? Prompt, int Count)>();
        foreach (var json in documents)
        {
            if (string.IsNullOrEmpty(json)) continue;
            try
            {
                using var document = JsonDocument.Parse(json);
                var root = document.RootElement;
                if (root.ValueKind != JsonValueKind.Object || String(root, "contentVersion") != version) continue;
                attempts++;
                if (!root.TryGetProperty("questions", out var questions) || questions.ValueKind != JsonValueKind.Array) continue;
                foreach (var question in questions.EnumerateArray())
                {
                    if (question.ValueKind != JsonValueKind.Object || !question.TryGetProperty("questionId", out var id) || id.ValueKind != JsonValueKind.Number || !id.TryGetInt32(out var number)) continue;
                    var prompt = String(question, "prompt") is { Length: > 0 } text ? text.Length > 160 ? text[..157] + "…" : text : null;
                    misses[number] = (misses.GetValueOrDefault(number).Prompt ?? prompt, misses.GetValueOrDefault(number).Count + 1);
                }
            }
            catch (Exception error) when (error is JsonException or InvalidOperationException or FormatException) { }
        }
        return (attempts, misses.OrderByDescending(pair => pair.Value.Count).ThenBy(pair => pair.Key).Take(5)
            .Select(pair => new AdminMissedQuestion(pair.Key, pair.Value.Prompt, pair.Value.Count, attempts)).ToArray());
    }
}
