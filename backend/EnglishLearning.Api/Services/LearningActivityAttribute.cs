using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EnglishLearning.Api.Entities;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Infrastructure;

namespace EnglishLearning.Api.Services;

[AttributeUsage(AttributeTargets.Method)]
public sealed class LearningActivityAttribute(LearningKind kind, int status = 200) : Attribute, IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var time = context.HttpContext.RequestServices.GetRequiredService<TimeProvider>();
        var day = LearningActivityService.VietnamDay(time.GetUtcNow());
        var result = await next();
        if (result.Exception is not null || result.Result is not IStatusCodeActionResult response ||
            response.StatusCode != status ||
            !int.TryParse(context.HttpContext.User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var userId))
            return;

        await context.HttpContext.RequestServices.GetRequiredService<LearningActivityService>()
            .RecordCompletedAsync(userId, kind, day);
    }
}
