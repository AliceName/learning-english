using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services.AiCourses;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

public sealed class AdminUserException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

/// <summary>
/// Account administration: list, read counts, lock/unlock, change role. Every change needs a reason, is written
/// to <see cref="AdminAuditLog"/>, and ends the user's sessions so it applies at once. Safety rules live here,
/// not in the UI: an admin cannot lock or demote themselves, and the last active admin cannot be removed.
/// </summary>
public sealed class AdminUserService(EnglishLearningDbContext db, RefreshSessions sessions, AdminAuditLog audit,
    AiCourseStore aiStore, LearningActivityService activity, TimeProvider time)
{
    public const int PageSize = 20;

    public async Task<AdminUserListResponse> ListAsync(AdminUserQuery query, CancellationToken ct)
    {
        var users = db.Users.AsNoTracking();
        if (query.Search?.Trim() is { Length: > 0 } search)
            users = users.Where(user => user.Email.Contains(search) || user.FullName.Contains(search));
        if (query.Role is { } role) users = users.Where(user => user.Role == role);
        if (query.Status is { } status) users = users.Where(user => user.IsActive == (status == "active"));
        users = query.Sort switch
        {
            "oldest" => users.OrderBy(user => user.CreatedAt).ThenBy(user => user.UserId),
            // Study days live in UserLearningDays; the old Users.LastStudyDate/CurrentStreak columns are never updated.
            "recent_study" => users.OrderByDescending(user => db.UserLearningDays.Where(day => day.UserId == user.UserId).Max(day => (DateOnly?)day.StudyDate))
                .ThenBy(user => user.UserId),
            "name" => users.OrderBy(user => user.FullName).ThenBy(user => user.UserId),
            _ => users.OrderByDescending(user => user.CreatedAt).ThenByDescending(user => user.UserId),
        };
        var total = await users.CountAsync(ct);
        var pages = Math.Max(1, (int)Math.Ceiling(total / (double)PageSize));
        var page = Math.Min(query.Page, pages);
        var rows = await users.Skip((page - 1) * PageSize).Take(PageSize)
            .Select(user => new { user.UserId, user.FullName, user.Email, user.Role, user.IsActive, user.CreatedAt,
                LastStudy = db.UserLearningDays.Where(day => day.UserId == user.UserId).Max(day => (DateOnly?)day.StudyDate) })
            .ToListAsync(ct);
        var items = new List<AdminUserListItem>(rows.Count);
        foreach (var row in rows)
            items.Add(new(row.UserId, row.FullName, row.Email, row.Role, row.IsActive, row.CreatedAt, row.LastStudy,
                (await activity.SummaryAsync(row.UserId, activity.Today, ct)).CurrentStreak));
        return new(items, total, page, PageSize, pages);
    }

    public async Task<AdminUserDetail> GetAsync(int actorId, int id, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(item => item.UserId == id, ct)
            ?? throw new AdminUserException(404, "Không tìm thấy người dùng.");
        var now = time.GetUtcNow();
        var yearStart = new DateOnly(now.Year, 1, 1);
        var deckIds = db.FlashcardDecks.Where(deck => deck.UserId == id).Select(deck => deck.DeckId);
        var stats = new AdminUserStats(
            await db.UserLearningDays.Where(day => day.UserId == id && day.StudyDate >= yearStart).Select(day => day.StudyDate).Distinct().CountAsync(ct),
            await db.WritingSubmissions.CountAsync(item => item.UserId == id, ct),
            await deckIds.CountAsync(ct),
            await db.Flashcards.CountAsync(card => deckIds.Contains(card.DeckId), ct),
            await db.UserCourses.CountAsync(item => item.UserId == id, ct),
            await AiCallsAsync(id, now.AddDays(-30), ct));
        var history = await HistoryAsync(id, 20, ct);
        var streak = await activity.SummaryAsync(id, activity.Today, ct);
        var lastStudy = await db.UserLearningDays.Where(day => day.UserId == id).MaxAsync(day => (DateOnly?)day.StudyDate, ct);
        return new(user.UserId, user.FullName, user.Email, user.Role, user.IsActive, user.TargetLevel, user.CreatedAt, user.UpdatedAt,
            lastStudy, streak.CurrentStreak, streak.LongestStreak, stats, history, user.UserId == actorId);
    }

    public Task<IReadOnlyList<AdminAuditEntry>> RecentAsync(CancellationToken ct) => HistoryAsync(null, 10, ct);

    public async Task<AdminUserDetail> SetActiveAsync(int actorId, int id, bool active, string reason, CancellationToken ct)
    {
        var user = await db.Users.SingleOrDefaultAsync(item => item.UserId == id, ct)
            ?? throw new AdminUserException(404, "Không tìm thấy người dùng.");
        if (user.IsActive == active) return await GetAsync(actorId, id, ct);
        if (!active)
        {
            if (id == actorId) throw new AdminUserException(409, "Bạn không thể tự khóa tài khoản của mình.");
            if (user.Role == UserRoles.Admin) await EnsureAnotherAdminAsync(id, ct);
        }
        user.IsActive = active;
        user.UpdatedAt = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(ct);
        if (!active) sessions.RevokeUser(id);
        await audit.WriteAsync(actorId, id, active ? "unlock" : "lock", active ? "locked" : "active", active ? "active" : "locked", reason.Trim(), ct);
        return await GetAsync(actorId, id, ct);
    }

    public async Task<AdminUserDetail> SetRoleAsync(int actorId, int id, string role, string reason, CancellationToken ct)
    {
        var user = await db.Users.SingleOrDefaultAsync(item => item.UserId == id, ct)
            ?? throw new AdminUserException(404, "Không tìm thấy người dùng.");
        if (user.Role == role) return await GetAsync(actorId, id, ct);
        if (user.Role == UserRoles.Admin)
        {
            if (id == actorId) throw new AdminUserException(409, "Bạn không thể tự bỏ quyền quản trị của mình.");
            if (user.IsActive) await EnsureAnotherAdminAsync(id, ct);
        }
        var previous = user.Role;
        user.Role = role;
        user.UpdatedAt = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(ct);
        // The role travels in the access token; ending the sessions makes the new role apply on the next sign-in.
        sessions.RevokeUser(id);
        await audit.WriteAsync(actorId, id, "role", previous, role, reason.Trim(), ct);
        return await GetAsync(actorId, id, ct);
    }

    private async Task EnsureAnotherAdminAsync(int id, CancellationToken ct)
    {
        if (!await db.Users.AnyAsync(user => user.UserId != id && user.Role == UserRoles.Admin && user.IsActive, ct))
            throw new AdminUserException(409, "Đây là quản trị viên đang hoạt động cuối cùng; hãy cấp quyền cho người khác trước.");
    }

    private async Task<IReadOnlyList<AdminAuditEntry>> HistoryAsync(int? targetId, int take, CancellationToken ct)
    {
        var entries = await audit.ReadAsync(targetId, take, ct);
        var actorIds = entries.Select(entry => entry.ActorId).Distinct().ToArray();
        var names = await db.Users.AsNoTracking().Where(user => actorIds.Contains(user.UserId))
            .ToDictionaryAsync(user => user.UserId, user => user.FullName, ct);
        return entries.Select(entry => new AdminAuditEntry(entry.At, entry.ActorId, names.GetValueOrDefault(entry.ActorId),
            entry.TargetId, entry.Action, entry.From, entry.To, entry.Reason)).ToArray();
    }

    /// <summary>AI course-generation calls are kept in the AI file store; null when it cannot be read.</summary>
    private async Task<int?> AiCallsAsync(int id, DateTimeOffset from, CancellationToken ct)
    {
        try
        {
            if (!Directory.Exists(Path.Combine(aiStore.Root, "calls"))) return 0;
            using var gate = await aiStore.LockAsync(ct);
            return aiStore.Calls().Count(call => call.UserId == id && call.StartedAt >= from);
        }
        catch (IOException) { return null; }
    }
}
