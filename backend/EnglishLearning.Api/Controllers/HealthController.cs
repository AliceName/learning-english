using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Controllers;

[ApiController]
[Route("api/v1/health")]
[Tags("Health")]
[Produces("application/json")]
public sealed class HealthController : ControllerBase
{
    [HttpGet]
    [ProducesResponseType<HealthResponse>(StatusCodes.Status200OK)]
    public ActionResult<HealthResponse> GetHealth() =>
        Ok(new HealthResponse("healthy", "English Learning API is running"));

    [HttpGet("database")]
    [ProducesResponseType<HealthResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<HealthResponse>(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<HealthResponse>> GetDatabaseHealth(
        [FromServices] EnglishLearningDbContext dbContext,
        CancellationToken cancellationToken)
    {
        if (await dbContext.Database.CanConnectAsync(cancellationToken))
        {
            return Ok(new HealthResponse("healthy", "SQL Server connection successful"));
        }

        return StatusCode(StatusCodes.Status503ServiceUnavailable,
            new HealthResponse("unavailable", "SQL Server connection failed"));
    }
}
