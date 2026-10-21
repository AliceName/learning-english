using System.Data.Common;
using System.Security.Claims;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Controllers;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed class AuthCancellationTests
{
    [Theory]
    [InlineData("login", true)]
    [InlineData("register", true)]
    [InlineData("me", true)]
    [InlineData("login", false)]
    [InlineData("register", false)]
    [InlineData("me", false)]
    public async Task Database_cancellation_distinguishes_client_disconnect_from_server_failure(string endpoint, bool cancelRequest)
    {
        using var requestCancellation = new CancellationTokenSource();
        var interceptor = new CancelConnectionInterceptor(requestCancellation, cancelRequest);
        await using var dbContext = new EnglishLearningDbContext(
            new DbContextOptionsBuilder<EnglishLearningDbContext>()
                .UseSqlServer("Server=localhost;Database=CancellationTests;Integrated Security=True")
                .AddInterceptors(interceptor).Options);
        var hasher = new PasswordHasher<User>();
        using var limiter = new LoginAttemptLimiter();
        var controller = new AuthController(
            new RegistrationService(dbContext, hasher),
            new LoginService(dbContext, hasher),
            new JwtTokenService(Options.Create(new JwtOptions
            {
                Issuer = "EnglishLearning.Api", Audience = "EnglishLearning.Web", SigningKey = TestJwt.SigningKey
            }), TimeProvider.System),
            limiter, dbContext, NullLogger<AuthController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    RequestAborted = requestCancellation.Token,
                    User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "1")], "test"))
                }
            }
        };

        IActionResult? result = endpoint switch
        {
            "login" => (await controller.Login(new LoginRequest
            {
                Email = "cancellation-test@example.com", Password = "TestPassword123"
            }, requestCancellation.Token)).Result,
            "register" => (await controller.Register(new RegisterRequest
            {
                Email = "cancellation-test@example.com", FullName = "Test Learner",
                Password = "TestPassword123", ConfirmPassword = "TestPassword123"
            }, requestCancellation.Token)).Result,
            "me" => (await controller.GetCurrentUser(requestCancellation.Token)).Result,
            _ => throw new ArgumentOutOfRangeException(nameof(endpoint))
        };

        Assert.True(interceptor.WasCalled);
        if (cancelRequest)
        {
            Assert.Equal(StatusCodes.Status499ClientClosedRequest, Assert.IsType<StatusCodeResult>(result).StatusCode);
        }
        else
        {
            var response = Assert.IsType<ObjectResult>(result);
            Assert.Equal(StatusCodes.Status503ServiceUnavailable, response.StatusCode);
            var problem = Assert.IsType<ProblemDetails>(response.Value);
            Assert.Equal("Hệ thống đang bận. Vui lòng thử lại sau.", problem.Detail);
        }
        Assert.Empty(dbContext.ChangeTracker.Entries<User>());
    }

    private sealed class CancelConnectionInterceptor(CancellationTokenSource requestCancellation, bool cancelRequest) : DbConnectionInterceptor
    {
        public bool WasCalled { get; private set; }

        public override ValueTask<InterceptionResult> ConnectionOpeningAsync(DbConnection connection,
            ConnectionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
        {
            WasCalled = true;
            if (cancelRequest) requestCancellation.Cancel();
            return ValueTask.FromException<InterceptionResult>(
                new TaskCanceledException("Simulated connection cancellation.", null, cancellationToken));
        }
    }
}
