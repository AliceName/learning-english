using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EnglishLearning.Api.Controllers;

[ApiController]
[Route("api/v1/writing/tasks")]
public sealed class WritingTasksController(WritingTaskLibrary catalogue) : ControllerBase
{
    [AllowAnonymous, HttpGet]
    public IActionResult Get()
    {
        Response.Headers.CacheControl = "no-store";
        try { return Ok(catalogue.Load()); }
        catch (Exception e) when (e is IOException or InvalidDataException or InvalidOperationException or System.Text.Json.JsonException)
        { return Problem(statusCode: 503, title: "Chưa tải được thư viện đề cục bộ. Hãy thử lại."); }
    }
}
