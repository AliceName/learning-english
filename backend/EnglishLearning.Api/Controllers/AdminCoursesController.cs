using System.Data;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[ApiController, Authorize(Roles = UserRoles.Admin), Route("api/v1/admin/courses"), Tags("Admin courses")]
[ProducesResponseType(StatusCodes.Status401Unauthorized)]
[ProducesResponseType(StatusCodes.Status403Forbidden)]
public sealed class AdminCoursesController(CourseAuthoringService authoring, EnglishLearningDbContext db,
    ILogger<AdminCoursesController> logger) : ControllerBase
{
    [HttpGet]
    public Task<ActionResult<AdminCourseListResponse>> List([FromQuery] AdminCourseQuery query, CancellationToken ct) =>
        ExecuteAsync(_ => authoring.ListAsync(query, ct), false, ct);
    [HttpGet("{id:int:min(1)}")]
    public Task<ActionResult<AdminCourseResponse>> Get(int id, CancellationToken ct) => ExecuteAsync(_ => authoring.GetAsync(id, ct), false, ct);
    [HttpPost, RequestSizeLimit(256 * 1024)]
    public Task<ActionResult<AdminCourseResponse>> Create(CreateCourseRequest request, CancellationToken ct) =>
        ExecuteAsync(userId => authoring.CreateAsync(userId, request, ct), true, ct, created: true);
    [HttpPut("{id:int:min(1)}"), RequestSizeLimit(256 * 1024)]
    public Task<ActionResult<AdminCourseResponse>> Update(int id, SaveCourseRequest request, CancellationToken ct) =>
        ExecuteAsync(_ => authoring.UpdateAsync(id, request, ct), true, ct);
    [HttpPost("{id:int:min(1)}/lessons"), RequestSizeLimit(256 * 1024)]
    public Task<ActionResult<AdminCourseResponse>> AddLesson(int id, SaveLessonRequest request, CancellationToken ct) =>
        ExecuteAsync(_ => authoring.SaveLessonAsync(id, null, request, ct), true, ct);
    [HttpPut("{id:int:min(1)}/lessons/{lessonId:int:min(1)}"), RequestSizeLimit(256 * 1024)]
    public Task<ActionResult<AdminCourseResponse>> SaveLesson(int id, int lessonId, SaveLessonRequest request, CancellationToken ct) =>
        ExecuteAsync(_ => authoring.SaveLessonAsync(id, lessonId, request, ct), true, ct);
    [HttpPost("{id:int:min(1)}/question-import/preview"), Consumes("multipart/form-data")]
    [RequestSizeLimit(QuestionDocxImport.MaxRequestBytes), RequestFormLimits(MultipartBodyLengthLimit = QuestionDocxImport.MaxRequestBytes)]
    public Task<ActionResult<QuestionImportPreview>> PreviewQuestionImport(int id, [FromForm] IFormFile? file,
        [FromForm] string skillType, [FromForm] int? lessonId, CancellationToken ct) =>
        ExecuteAsync(async _ =>
        {
            if (skillType is not ("reading" or "grammar"))
                throw new AuthoringException(400, "Chọn bài Reading hoặc Grammar để nhập câu hỏi.");
            if (file is null || file.Length == 0)
                throw new AuthoringException(400, "Chọn tệp Word có nội dung.");
            if (file.Length > QuestionDocxImport.MaxFileBytes)
                throw new AuthoringException(413, "Tệp Word tối đa 2 MB.");
            if (!Path.GetExtension(file.FileName).Equals(".docx", StringComparison.OrdinalIgnoreCase))
                throw new AuthoringException(415, "Chỉ hỗ trợ tệp Word .docx.");
            if (!await db.Courses.AnyAsync(course => course.CourseId == id && course.SourceType == "system", ct))
                throw new AuthoringException(404, "Không tìm thấy khóa học.");
            if (lessonId is int target && !await db.Lessons.AnyAsync(lesson =>
                lesson.LessonId == target && lesson.CourseId == id && lesson.SkillType == skillType, ct))
                throw new AuthoringException(404, "Không tìm thấy bài học phù hợp trong khóa này.");

            using var stream = file.OpenReadStream();
            return QuestionDocxImport.Read(stream, ct);
        }, false, ct);

    [HttpPost("{id:int:min(1)}/publish")]
    public Task<ActionResult<AdminCourseResponse>> Publish(int id, CancellationToken ct) => ExecuteAsync(_ => authoring.PublishAsync(id, ct), true, ct);
    [HttpPost("{id:int:min(1)}/hide")]
    public Task<ActionResult<AdminCourseResponse>> Hide(int id, CancellationToken ct) => ExecuteAsync(_ => authoring.HideAsync(id, ct), true, ct);

    private async Task<ActionResult<T>> ExecuteAsync<T>(Func<int, Task<T>> action, bool write, CancellationToken ct, bool created = false)
    {
        Response.Headers.CacheControl = "no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var userId)) return Unauthorized();
        try
        {
            var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(item => item.UserId == userId && item.IsActive, ct);
            if (user is null) return Unauthorized();
            if (user.Role != UserRoles.Admin) return Forbid();
            // Serialize editing and visibility changes; reuse the enclosing rollback transaction in integration tests.
            await using var transaction = write && db.Database.CurrentTransaction is null
                ? await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct) : null;
            var result = await action(userId);
            if (transaction is not null) await transaction.CommitAsync(ct);
            return created ? StatusCode(StatusCodes.Status201Created, result) : Ok(result);
        }
        catch (AuthoringException error) { return Problem(statusCode: error.Status, title: error.Message); }
        catch (CloudMediaException error)
        {
            logger.LogWarning("Course media verification failed ({Code}).", error.Code);
            if (error.RetryAfterSeconds is int seconds) Response.Headers.RetryAfter = seconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return Problem(statusCode: error.Status, title: "Chưa xác minh được media khóa học. Vui lòng thử lại.", extensions: new Dictionary<string, object?> { ["code"] = error.Code });
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is SqlException or DbUpdateException or OperationCanceledException)
        {
            logger.LogError(error, "Course authoring database request failed.");
            return Problem(statusCode: 503, title: "Chưa thể lưu hoặc tải khóa học. Vui lòng thử lại.");
        }
    }
}
