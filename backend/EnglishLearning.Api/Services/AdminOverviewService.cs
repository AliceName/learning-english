using System.Linq.Expressions;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services.AiCourses;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

/// <summary>
/// Which accounts admin statistics count as real learners: admins, test accounts (email ending in .test, an
/// @example. domain, "test" in the name) and ids listed in <c>AdminOverview:ExcludedUserIds</c> are left out.
/// There is no test flag in the schema, so this is a rule, and the pages say so.
/// </summary>
public sealed class AdminLearnerFilter(IConfiguration configuration)
{
    public Expression<Func<User, bool>> RealLearner()
    {
        var excluded = configuration.GetSection("AdminOverview:ExcludedUserIds").Get<int[]>() ?? [];
        return user => user.Role != UserRoles.Admin && !user.Email.ToLower().EndsWith(".test") && !user.Email.ToLower().Contains("@example.")
            && !user.FullName.ToLower().Contains("test") && !excluded.Contains(user.UserId);
    }
}

/// <summary>Read-only counts for the admin overview; learner numbers use <see cref="AdminLearnerFilter"/>.</summary>
public sealed class AdminOverviewService(EnglishLearningDbContext db, AiCourseStore aiStore, AdminUserService users,
    LearningActivityService activity, AdminLearnerFilter filter, TimeProvider time)
{
    public const int DailyWindow = 14;

    public async Task<AdminOverview> GetAsync(CancellationToken ct)
    {
        var now = time.GetUtcNow();
        var today = activity.Today;
        var learners = db.Users.AsNoTracking().Where(filter.RealLearner());
        var learnerIds = learners.Select(user => user.UserId);
        var counted = await learners.CountAsync(ct);
        var excluded = await db.Users.CountAsync(ct) - counted;

        var days = db.UserLearningDays.AsNoTracking().Where(day => learnerIds.Contains(day.UserId) && day.StudyDate > today.AddDays(-30));
        var recentDays = await days.Select(day => new { day.UserId, day.StudyDate, day.Kind }).ToListAsync(ct);
        int Learners(int span) => recentDays.Where(day => day.StudyDate > today.AddDays(-span)).Select(day => day.UserId).Distinct().Count();

        var since7 = now.UtcDateTime.AddDays(-7);
        var since30 = now.UtcDateTime.AddDays(-30);
        var essays = db.WritingSubmissions.AsNoTracking().Where(item => learnerIds.Contains(item.UserId) && item.CreatedAt >= since30);
        var essays7 = essays.Where(item => item.CreatedAt >= since7);
        // A revision names its first version; first versions store "rootSubmissionId":null.
        var revisions7 = await essays7.CountAsync(item => item.ErrorsJson != null && item.ErrorsJson.Contains("\"rootSubmissionId\":")
            && !item.ErrorsJson.Contains("\"rootSubmissionId\":null"), ct);
        var (aiCalls, aiErrors, failedJobs) = await AiAsync(now.AddDays(-7), ct);

        var activityCounts = new AdminOverviewActivity(
            Learners(1), Learners(7), Learners(30),
            await learners.CountAsync(user => user.CreatedAt >= since7, ct), await learners.CountAsync(user => user.CreatedAt >= since30, ct),
            await essays7.CountAsync(ct), revisions7, await essays.CountAsync(ct), aiCalls, aiErrors);

        var daily = Enumerable.Range(0, DailyWindow).Select(offset => today.AddDays(offset - DailyWindow + 1))
            .Select(date => new AdminOverviewDay(date, recentDays.Where(day => day.StudyDate == date).Select(day => day.UserId).Distinct().Count()))
            .ToArray();
        var skills = recentDays.GroupBy(day => day.Kind)
            .Select(group => new AdminOverviewSkill(group.Key.ToString().ToLowerInvariant(), group.Select(day => day.UserId).Distinct().Count()))
            .OrderByDescending(skill => skill.Learners).ThenBy(skill => skill.Kind).ToArray();

        var attention = new List<AdminOverviewAttention>();
        var locked = await db.Users.CountAsync(user => !user.IsActive, ct);
        if (locked > 0) attention.Add(new("locked_accounts", locked, "/admin/users?status=locked"));
        var hidden = await db.Courses.CountAsync(course => course.SourceType == "system" && !course.IsPublished, ct);
        if (hidden > 0) attention.Add(new("hidden_courses", hidden, "/admin/courses"));
        if (failedJobs > 0) attention.Add(new("failed_ai_courses", failedJobs.Value, "/admin/ai-usage"));

        var recent = (await users.RecentAsync(ct)).Take(5).ToArray();
        return new(now, today, counted, excluded, activityCounts, daily, skills, attention, recent);
    }

    /// <summary>AI course calls live in the AI file store; null when it cannot be read.</summary>
    private async Task<(int? Calls, int? Errors, int? FailedJobs)> AiAsync(DateTimeOffset from, CancellationToken ct)
    {
        try
        {
            if (!Directory.Exists(Path.Combine(aiStore.Root, "calls"))) return (0, 0, 0);
            using var gate = await aiStore.LockAsync(ct);
            var calls = aiStore.Calls().Where(call => call.StartedAt >= from).ToArray();
            var failed = Directory.Exists(Path.Combine(aiStore.Root, "jobs"))
                ? aiStore.Jobs().Count(job => job.CreatedAt >= from && job.Status == "failed") : 0;
            // A call still running ("started") is not an error yet.
            return (calls.Length, calls.Count(call => call.Outcome is not ("success" or "started")), failed);
        }
        catch (IOException) { return (null, null, null); }
    }
}
