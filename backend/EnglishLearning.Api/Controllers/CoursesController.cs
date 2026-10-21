using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/courses")]
[Tags("Courses")]
[Produces("application/json")]
[ProducesResponseType(StatusCodes.Status401Unauthorized)]
[ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable)]
public sealed class CoursesController(CourseCatalogService catalog, EnglishLearningDbContext dbContext,
    ILogger<CoursesController> logger) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType<CourseListResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public Task<ActionResult<CourseListResponse>> List([FromQuery] CourseListQuery query, CancellationToken cancellationToken) =>
        ReadAsync<CourseListResponse>(async userId => await catalog.ListAsync(userId, query, cancellationToken), cancellationToken);

    [HttpGet("{courseId:int:min(1)}")]
    [ProducesResponseType<CourseDetailResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<ActionResult<CourseDetailResponse>> Get(int courseId, CancellationToken cancellationToken) =>
        ReadAsync(userId => catalog.GetAsync(userId, courseId, cancellationToken), cancellationToken);

    private async Task<ActionResult<T>> ReadAsync<T>(Func<int, Task<T?>> read, CancellationToken cancellationToken) where T : class
    {
        Response.Headers.CacheControl = "no-store";
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var userId) || userId <= 0)
            return Unauthorized();
        try
        {
            if (!await dbContext.Users.AnyAsync(item => item.UserId == userId && item.IsActive, cancellationToken))
                return Unauthorized();
            var result = await read(userId);
            return result is null ? NotFound() : Ok(result);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return StatusCode(StatusCodes.Status499ClientClosedRequest);
        }
        catch (Exception error) when (error is SqlException or OperationCanceledException)
        {
            logger.LogError(error, "Database request failed while loading the course catalog.");
            return Problem(statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Chưa thể tải khóa học.", detail: "Hệ thống đang bận. Vui lòng thử lại sau.");
        }
    }
}
