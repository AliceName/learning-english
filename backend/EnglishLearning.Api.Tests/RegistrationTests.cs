using System.ComponentModel.DataAnnotations;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace EnglishLearning.Api.Tests;

public sealed class RegistrationValidationTests
{
    [Theory]
    [InlineData("wrong-email", "Learner", "ValidPassword8", "ValidPassword8", null)]
    [InlineData("learner@example.com", "   ", "ValidPassword8", "ValidPassword8", null)]
    [InlineData("learner@example.com", "Learner", "short", "short", null)]
    [InlineData("learner@example.com", "Learner", "ValidPassword8", "DifferentPassword8", null)]
    [InlineData("learner@example.com", "Learner", "ValidPassword8", "ValidPassword8", "B3")]
    public void Invalid_registration_is_rejected(string email, string fullName, string password, string confirmPassword, string? targetLevel)
    {
        var request = new RegisterRequest { Email = email, FullName = fullName, Password = password, ConfirmPassword = confirmPassword, TargetLevel = targetLevel };
        Assert.False(Validator.TryValidateObject(request, new ValidationContext(request), [], true));
    }
}

public sealed class SqlServerFactAttribute : FactAttribute
{
    public SqlServerFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ENGLISHLEARNING_TEST_CONNECTION_STRING")))
            Skip = "Set ENGLISHLEARNING_TEST_CONNECTION_STRING to run SQL Server integration tests.";
    }
}

public sealed partial class RegistrationSqlServerTests : IAsyncLifetime
{
    private SqlConnection connection = null!;
    private SqlTransaction transaction = null!;
    private WebApplicationFactory<Program> factory = null!;
    private HttpClient client = null!;

    public async Task InitializeAsync()
    {
        connection = new SqlConnection(Environment.GetEnvironmentVariable("ENGLISHLEARNING_TEST_CONNECTION_STRING"));
        await connection.OpenAsync();
        transaction = (SqlTransaction)await connection.BeginTransactionAsync();
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseEnvironment("Development")
                .ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(
                    new Dictionary<string, string?> { ["Jwt:SigningKey"] = TestJwt.SigningKey }))
                .ConfigureServices(services =>
            {
                services.RemoveAll<EnglishLearningDbContext>();
                services.RemoveAll<DbContextOptions<EnglishLearningDbContext>>();
                services.AddScoped(_ =>
                {
                    var context = new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>().UseSqlServer(connection).Options);
                    context.Database.UseTransaction(transaction);
                    return context;
                });
            }));
        client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    public async Task DisposeAsync()
    {
        client?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        if (transaction is not null) { await transaction.RollbackAsync(); await transaction.DisposeAsync(); }
        if (connection is not null) await connection.DisposeAsync();
    }

    private static object Payload(string email, string password = "Learning@2026", string? targetLevel = "B1") =>
        new { email, fullName = "  Nguyễn Minh Anh  ", password, confirmPassword = password, targetLevel };

    [SqlServerFact]
    public async Task Registration_persists_a_salted_verifiable_hash_and_database_defaults()
    {
        var email = $"register-{Guid.NewGuid():N}@example.com";
        var response = await client.PostAsJsonAsync("/api/v1/auth/register", Payload("  " + email.ToUpperInvariant() + "  "));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var json = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("password", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Learning@2026", json);
        var result = JsonDocument.Parse(json).RootElement.GetProperty("user");
        Assert.Equal(email, result.GetProperty("email").GetString());
        Assert.Equal("Nguyễn Minh Anh", result.GetProperty("fullName").GetString());

        using var scope = factory.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var user = await context.Users.SingleAsync(item => item.Email == email);
        Assert.Equal(result.GetProperty("userId").GetInt32(), user.UserId);
        Assert.InRange(user.PasswordHash.Length, 50, 255);
        var hasher = new PasswordHasher<User>();
        Assert.NotEqual(PasswordVerificationResult.Failed, hasher.VerifyHashedPassword(user, user.PasswordHash, "Learning@2026"));
        Assert.Equal(PasswordVerificationResult.Failed, hasher.VerifyHashedPassword(user, user.PasswordHash, "WrongPassword"));
        Assert.NotEqual(user.PasswordHash, hasher.HashPassword(user, "Learning@2026"));
        Assert.True(user.IsActive);
        Assert.Equal(0, user.CurrentStreak);
        Assert.Equal(0, user.LongestStreak);
        Assert.Null(user.AvatarUrl);
        Assert.Null(user.LastStudyDate);
        Assert.Equal("B1", user.TargetLevel);
        Assert.NotEqual(default, user.CreatedAt);
        Assert.NotEqual(default, user.UpdatedAt);
    }

    [SqlServerFact]
    public async Task Duplicate_email_is_rejected_case_insensitively_without_changing_the_account()
    {
        var email = $"duplicate-{Guid.NewGuid():N}@example.com";
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/v1/auth/register", Payload(email))).StatusCode);
        var duplicate = await client.PostAsJsonAsync("/api/v1/auth/register", Payload(email.ToUpperInvariant(), "DifferentPassword8"));
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        Assert.Contains("email", await duplicate.Content.ReadAsStringAsync());
        using var scope = factory.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        Assert.Equal(1, await context.Users.CountAsync(item => item.Email == email));
        var user = await context.Users.SingleAsync(item => item.Email == email);
        Assert.NotEqual(PasswordVerificationResult.Failed, new PasswordHasher<User>().VerifyHashedPassword(user, user.PasswordHash, "Learning@2026"));
    }

    [SqlServerFact]
    public async Task Optional_cefr_is_nullable_and_invalid_input_does_not_create_an_account()
    {
        var email = $"optional-{Guid.NewGuid():N}@example.com";
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/v1/auth/register", Payload(email, targetLevel: null))).StatusCode);
        var invalidEmail = $"invalid-{Guid.NewGuid():N}@example.com";
        var response = await client.PostAsJsonAsync("/api/v1/auth/register", new { email = invalidEmail, fullName = "Learner", password = "Learning@2026", confirmPassword = "DifferentPassword8", targetLevel = "B3" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var scope = factory.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        Assert.Null((await context.Users.SingleAsync(item => item.Email == email)).TargetLevel);
        Assert.False(await context.Users.AnyAsync(item => item.Email == invalidEmail));
    }

    [SqlServerFact]
    public async Task Actual_sql_server_columns_match_the_markdown_schema()
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT t.name,c.name,ty.name,c.max_length,c.precision,c.scale,c.is_nullable,c.is_identity,dc.definition
            FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id
            JOIN sys.types ty ON ty.user_type_id=c.user_type_id
            LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id
            WHERE t.is_ms_shipped=0 ORDER BY t.name,c.column_id
            """;
        var schema = ApprovedSchema.Read();
        var count = 0;
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var table = reader.GetString(0);
            Assert.True(schema.ContainsKey(table), $"Unapproved table: {table}");
            var column = Assert.Single(schema[table], column => column.Name == reader.GetString(1));
            var type = reader.GetString(2);
            if (type == "nvarchar") type += reader.GetInt16(3) == -1 ? "(max)" : $"({reader.GetInt16(3) / 2})";
            if (type == "decimal") type += $"({reader.GetByte(4)},{reader.GetByte(5)})";
            Assert.Equal(column.Type.ToLowerInvariant(), type);
            Assert.Equal(column.Nullable, reader.GetBoolean(6));
            Assert.Equal(column.Identity, reader.GetBoolean(7));
            Assert.Equal(ApprovedSchema.NormalizeDefault(column.Default), ApprovedSchema.NormalizeDefault(reader.IsDBNull(8) ? null : reader.GetString(8)));
            count++;
        }
        Assert.Equal(122, count);
    }
}
