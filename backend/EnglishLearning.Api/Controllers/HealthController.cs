using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MongoDB.Bson;
using MongoDB.Driver;
using EnglishLearning.Api.Configuration;
using Microsoft.Extensions.Options;
using EnglishLearning.Api.Services;

namespace EnglishLearning.Api.Controllers;

[ApiController]
[Route("api/v1/health")]
[Tags("Health")]
[Produces("application/json")]
public sealed class HealthController : ControllerBase
{
    [HttpGet("media")]
    public ActionResult<MediaRuntimeStatus> GetMediaRuntime([FromServices] MediaRuntimeState runtime)
    { Response.Headers.CacheControl = "no-store"; return Ok(runtime.Status()); }
    [HttpGet("mongodb")]
    [ProducesResponseType<HealthResponse>(200)]
    [ProducesResponseType<HealthResponse>(503)]
    public async Task<ActionResult<HealthResponse>> GetMongoHealth([FromServices] IMongoDatabase database,
        [FromServices] IOptions<MongoDbSettings> options, CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(options.Value.OperationTimeoutMs);
        try
        {
            await database.RunCommandAsync<BsonDocument>(new BsonDocument("ping", 1), cancellationToken: deadline.Token);
            return Ok(new HealthResponse("healthy", "MongoDB connection successful"));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { return StatusCode(499); }
        catch (Exception error) when (error is MongoException or OperationCanceledException or TimeoutException)
        { return StatusCode(503, new HealthResponse("unavailable", "MongoDB connection failed")); }
    }

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
