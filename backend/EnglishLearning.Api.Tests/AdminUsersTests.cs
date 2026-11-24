using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace EnglishLearning.Api.Tests;

public sealed class AdminUsersTests : IAsyncLifetime
{
    private const string Password = "Learner-password-1";
    private readonly string auditRoot = Path.Combine(Path.GetTempPath(), "lewa-admin-audit-" + Guid.NewGuid().ToString("N"));
    private WebApplicationFactory<Program> factory = null!;
    private HttpClient admin = null!, learner = null!;
    private int adminId, learnerId;

    public async Task InitializeAsync()
    {
        var database = Guid.NewGuid().ToString();
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseEnvironment("Development")
                .ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only", ["AdminAudit:Root"] = auditRoot
                }))
                .ConfigureServices(services =>
                {
                    services.RemoveAll<EnglishLearningDbContext>();
                    services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>()
                        .UseInMemoryDatabase(database).ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options));
                }));
        admin = factory.CreateClient();
        learner = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>();
        var a = new User { Email = "admin@example.test", FullName = "Quản trị A", PasswordHash = "x", IsActive = true, Role = UserRoles.Admin };
        var b = new User { Email = "learner@example.test", FullName = "Học viên B", IsActive = true };
        b.PasswordHash = hasher.HashPassword(b, Password);
        db.Users.AddRange(a, b, new User { Email = "other@example.test", FullName = "Người khác", PasswordHash = "x", IsActive = false });
        await db.SaveChangesAsync();
        (adminId, learnerId) = (a.UserId, b.UserId);
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(7));
        db.UserLearningDays.AddRange(new UserLearningDay { UserId = b.UserId, StudyDate = today.AddDays(-1), Kind = LearningKind.Writing },
            new UserLearningDay { UserId = b.UserId, StudyDate = today, Kind = LearningKind.Flashcards });
        await db.SaveChangesAsync();
        var tokens = scope.ServiceProvider.GetRequiredService<JwtTokenService>();
        admin.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.CreateToken(a).AccessToken);
        learner.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.CreateToken(b).AccessToken);
    }

    public async Task DisposeAsync()
    {
        await factory.DisposeAsync();
        if (Directory.Exists(auditRoot)) Directory.Delete(auditRoot, true);
    }

    private static object Reason(string text = "Kiểm thử khóa tài khoản") => new { reason = text };

    [Fact]
    public async Task List_filters_by_search_role_and_status_and_is_admin_only()
    {
        var all = (await admin.GetFromJsonAsync<AdminUserListResponse>("/api/v1/admin/users"))!;
        Assert.Equal(3, all.TotalCount);
        var found = Assert.Single((await admin.GetFromJsonAsync<AdminUserListResponse>("/api/v1/admin/users?search=learner"))!.Items);
        // Streak and last study day come from UserLearningDays, not the unused Users columns.
        Assert.Equal((2, DateOnly.FromDateTime(DateTime.UtcNow.AddHours(7))), (found.CurrentStreak, found.LastStudyDate));
        Assert.Equal(learnerId, (await admin.GetFromJsonAsync<AdminUserListResponse>("/api/v1/admin/users?sort=recent_study"))!.Items[0].UserId);
        Assert.Equal(adminId, Assert.Single((await admin.GetFromJsonAsync<AdminUserListResponse>("/api/v1/admin/users?role=admin"))!.Items).UserId);
        Assert.Equal("other@example.test", Assert.Single((await admin.GetFromJsonAsync<AdminUserListResponse>("/api/v1/admin/users?status=locked"))!.Items).Email);
        Assert.Equal(HttpStatusCode.Forbidden, (await learner.GetAsync("/api/v1/admin/users")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/v1/admin/users?role=root")).StatusCode);
    }

    [Fact]
    public async Task Locking_ends_sessions_blocks_access_and_login_says_locked_only_with_the_right_password()
    {
        var sessions = factory.Services.GetRequiredService<RefreshSessions>();
        var grant = sessions.Create(learnerId)!;
        using var locked = await admin.PostAsJsonAsync($"/api/v1/admin/users/{learnerId}/lock", Reason());
        Assert.Equal(HttpStatusCode.OK, locked.StatusCode);
        var detail = (await locked.Content.ReadFromJsonAsync<AdminUserDetail>())!;
        Assert.False(detail.IsActive);
        Assert.Equal(("lock", "Quản trị A"), (detail.History[0].Action, detail.History[0].ActorName));

        Assert.Null(sessions.FindUser(grant.Token));
        Assert.Equal(HttpStatusCode.Unauthorized, (await learner.GetAsync("/api/v1/auth/me")).StatusCode);
        using var anonymous = factory.CreateClient();
        using var rightPassword = await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email = "learner@example.test", password = Password });
        Assert.Equal(HttpStatusCode.Forbidden, rightPassword.StatusCode);
        Assert.Contains("bị khóa", await rightPassword.Content.ReadAsStringAsync());
        using var wrongPassword = await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email = "learner@example.test", password = "wrong-password-1" });
        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);

        using var unlocked = await admin.PostAsJsonAsync($"/api/v1/admin/users/{learnerId}/unlock", Reason("Đã xác minh, mở lại"));
        Assert.True((await unlocked.Content.ReadFromJsonAsync<AdminUserDetail>())!.IsActive);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email = "learner@example.test", password = Password })).StatusCode);
    }

    [Fact]
    public async Task Admins_cannot_lock_or_demote_themselves_and_every_change_needs_a_reason()
    {
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync($"/api/v1/admin/users/{adminId}/lock", Reason())).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsJsonAsync($"/api/v1/admin/users/{adminId}/role", new { role = "user", reason = "Tự hạ quyền" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/v1/admin/users/{learnerId}/lock", Reason("ok"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync("/api/v1/admin/users/99999/lock", Reason())).StatusCode);

        using var promoted = await admin.PutAsJsonAsync($"/api/v1/admin/users/{learnerId}/role", new { role = "admin", reason = "Trợ giảng phụ trách nội dung" });
        var detail = (await promoted.Content.ReadFromJsonAsync<AdminUserDetail>())!;
        Assert.Equal("admin", detail.Role);
        Assert.Equal(("role", "user", "admin"), (detail.History[0].Action, detail.History[0].From, detail.History[0].To));
        var recent = (await admin.GetFromJsonAsync<List<AdminAuditEntry>>("/api/v1/admin/users/audit"))!;
        Assert.Equal(learnerId, recent[0].TargetId);
        Assert.Equal(HttpStatusCode.Forbidden, (await learner.GetAsync("/api/v1/admin/users/audit")).StatusCode);
    }
}
