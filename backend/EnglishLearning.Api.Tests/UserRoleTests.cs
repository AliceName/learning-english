using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed partial class RegistrationSqlServerTests
{
    [SqlServerFact]
    public async Task Public_registration_cannot_choose_admin_and_login_and_me_return_the_user_role()
    {
        var email = $"role-{Guid.NewGuid():N}@example.com";
        var response = await client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email, fullName = "Regular learner", password = "Learning@2026", confirmPassword = "Learning@2026", role = "admin"
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(UserRoles.User, (await response.Content.ReadFromJsonAsync<RegistrationResponse>())!.User.Role);
        var login = await SignIn(email);
        Assert.Equal(UserRoles.User, login.User.Role);
        Assert.Equal(UserRoles.User, new JwtSecurityTokenHandler().ReadJwtToken(login.AccessToken).Claims.Single(claim => claim.Type == UserRoles.ClaimType).Value);
        Assert.Equal(UserRoles.User, (await (await GetMe(login.AccessToken)).Content.ReadFromJsonAsync<CurrentUserResponse>())!.Role);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        Assert.Equal(UserRoles.User, (await db.Users.SingleAsync(user => user.Email == email)).Role);
    }

    [SqlServerFact]
    public async Task Bootstrap_creates_one_hashed_admin_and_repeated_runs_do_not_reset_credentials()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var options = new BootstrapAdminOptions { Email = $"admin-{Guid.NewGuid():N}@example.com", Password = "BootstrapPassword!123" };
        var hasher = new PasswordHasher<User>();
        var bootstrap = new AdminBootstrapService(db, hasher, Options.Create(options));
        var result = await bootstrap.InitializeAsync();
        Assert.True(result.Created);
        var admin = await db.Users.SingleAsync(user => user.UserId == result.UserId);
        Assert.Equal(UserRoles.Admin, admin.Role);
        Assert.True(admin.IsActive);
        Assert.NotEqual(options.Password, admin.PasswordHash);
        Assert.Equal(PasswordVerificationResult.Success, hasher.VerifyHashedPassword(admin, admin.PasswordHash, options.Password));
        var originalHash = admin.PasswordHash;
        var originalUpdatedAt = admin.UpdatedAt;
        var repeated = await new AdminBootstrapService(db, hasher, Options.Create(new BootstrapAdminOptions
        {
            Email = options.Email.ToUpperInvariant(), Password = "DifferentPassword!456", FullName = "Do not overwrite"
        })).InitializeAsync();
        Assert.False(repeated.Created);
        Assert.Equal(result.UserId, repeated.UserId);
        await db.Entry(admin).ReloadAsync();
        Assert.Equal(originalHash, admin.PasswordHash);
        Assert.Equal(originalUpdatedAt, admin.UpdatedAt);
        Assert.Equal(options.FullName, admin.FullName);
        Assert.Equal(1, await db.Users.CountAsync(user => user.Email == options.Email));

        var loginResponse = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = options.Email, password = options.Password });
        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);
        var login = (await loginResponse.Content.ReadFromJsonAsync<LoginResponse>())!;
        Assert.Equal(UserRoles.Admin, login.User.Role);
        var bearer = factory.Services.GetRequiredService<IOptionsMonitor<JwtBearerOptions>>().Get(JwtBearerDefaults.AuthenticationScheme);
        var principal = new JwtSecurityTokenHandler { MapInboundClaims = false }.ValidateToken(login.AccessToken, bearer.TokenValidationParameters, out _);
        Assert.True(principal.IsInRole(UserRoles.Admin));
        Assert.False(principal.IsInRole(UserRoles.User));
        Assert.Equal(UserRoles.Admin, (await (await GetMe(login.AccessToken)).Content.ReadFromJsonAsync<CurrentUserResponse>())!.Role);
        Assert.DoesNotContain("password", await loginResponse.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }

    [SqlServerFact]
    public async Task Bootstrap_refuses_to_promote_a_regular_user_or_reactivate_a_disabled_admin()
    {
        var email = await RegisterLoginUser();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var user = await db.Users.SingleAsync(user => user.Email == email);
        var hash = user.PasswordHash;
        var bootstrap = new AdminBootstrapService(db, new PasswordHasher<User>(), Options.Create(new BootstrapAdminOptions { Email = email, Password = "BootstrapPassword!123" }));
        await Assert.ThrowsAsync<InvalidOperationException>(() => bootstrap.InitializeAsync());
        await db.Entry(user).ReloadAsync();
        Assert.Equal(UserRoles.User, user.Role);
        Assert.Equal(hash, user.PasswordHash);
        user.Role = UserRoles.Admin;
        user.IsActive = false;
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => bootstrap.InitializeAsync());
        await db.Entry(user).ReloadAsync();
        Assert.False(user.IsActive);
        Assert.Equal(hash, user.PasswordHash);
    }

    [SqlServerFact]
    public async Task Sql_role_default_is_user_and_the_database_rejects_unknown_roles()
    {
        // A direct insert omits Role to exercise the SQL default independently of the entity initializer.
        var email = $"default-role-{Guid.NewGuid():N}@example.com";
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "INSERT INTO dbo.Users (Email, PasswordHash, FullName) OUTPUT INSERTED.Role VALUES (@email, N'test-only', N'Role test');";
        command.Parameters.AddWithValue("@email", email);
        Assert.Equal(UserRoles.User, await command.ExecuteScalarAsync());
        command.Parameters.Add("@role", System.Data.SqlDbType.NVarChar, 20);
        foreach (var role in new[] { "owner", "ADMIN", "" })
        {
            command.CommandText = "UPDATE dbo.Users SET Role = @role WHERE Email = @email;";
            command.Parameters["@role"].Value = role;
            var error = await Assert.ThrowsAsync<SqlException>(() => command.ExecuteNonQueryAsync());
            Assert.Equal(547, error.Number);
        }
    }
}
