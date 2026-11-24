using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

public sealed record StreakSummary(int CurrentStreak, int LongestStreak, bool StudiedToday);
public sealed record ActivityDay(DateOnly Date, string[] Activities);
public sealed record LearningCalendar(int Year, DateOnly Today, DateOnly FirstDay, StreakSummary Streak, ActivityDay[] Days);

public sealed class LearningActivityService(EnglishLearningDbContext db, TimeProvider clock, ILogger<LearningActivityService> logger)
{
    public static DateOnly VietnamDay(DateTimeOffset instant) =>
        DateOnly.FromDateTime(instant.ToOffset(TimeSpan.FromHours(7)).DateTime);

    public DateOnly Today => VietnamDay(clock.GetUtcNow());

    public async Task RecordCompletedAsync(int userId, LearningKind kind, DateOnly day)
    {
        try
        {
            // A finished submission counts even if the browser leaves before reading its response.
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            await RecordAsync(userId, kind, day, deadline.Token);
        }
        catch (Exception error) when (error is SqlException or DbUpdateException or OperationCanceledException)
        {
            logger.LogWarning("Could not record {LearningKind} activity ({ErrorType}).", kind, error.GetType().Name);
        }
    }

    public async Task RecordAsync(int userId, LearningKind kind, DateOnly day, CancellationToken ct)
    {
        if (db.Database.IsSqlServer())
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO dbo.UserLearningDays (UserId, StudyDate, Kind)
                SELECT UserId, {day}, {(int)kind} FROM dbo.Users WHERE UserId = {userId} AND IsActive = 1
                AND NOT EXISTS (
                    SELECT 1 FROM dbo.UserLearningDays WITH (UPDLOCK, HOLDLOCK)
                    WHERE UserId = {userId} AND StudyDate = {day} AND Kind = {(int)kind}
                )
                """, ct);
            return;
        }

        if (!await db.Users.AnyAsync(user => user.UserId == userId && user.IsActive, ct) ||
            await db.UserLearningDays.AnyAsync(row => row.UserId == userId && row.StudyDate == day && row.Kind == kind, ct))
            return;
        db.UserLearningDays.Add(new UserLearningDay { UserId = userId, StudyDate = day, Kind = kind });
        await db.SaveChangesAsync(ct);
    }

    public async Task<StreakSummary> SummaryAsync(int userId, DateOnly today, CancellationToken ct)
    {
        var days = await db.UserLearningDays.AsNoTracking()
            .Where(row => row.UserId == userId && row.StudyDate <= today)
            .Select(row => row.StudyDate).Distinct().OrderBy(day => day).ToArrayAsync(ct);
        var longest = 0;
        var length = 0;
        DateOnly? previous = null;
        foreach (var day in days)
        {
            length = previous is { } prior && day.DayNumber == prior.DayNumber + 1 ? length + 1 : 1;
            longest = Math.Max(longest, length);
            previous = day;
        }
        var current = previous is { } last && today.DayNumber - last.DayNumber <= 1 ? length : 0;
        return new(current, longest, previous == today);
    }

    public async Task<LearningCalendar> CalendarAsync(int userId, int year, DateOnly first, DateOnly today, CancellationToken ct)
    {
        var start = new DateOnly(year, 1, 1);
        var end = new DateOnly(year, 12, 31);
        var rows = await db.UserLearningDays.AsNoTracking()
            .Where(row => row.UserId == userId && row.StudyDate >= start && row.StudyDate <= end && row.StudyDate <= today)
            .OrderBy(row => row.StudyDate).ThenBy(row => row.Kind).ToArrayAsync(ct);
        var days = rows.GroupBy(row => row.StudyDate).Select(group =>
            new ActivityDay(group.Key, group.Select(row => row.Kind.ToString().ToLowerInvariant()).ToArray())).ToArray();
        return new(year, today, first, await SummaryAsync(userId, today, ct), days);
    }
}
