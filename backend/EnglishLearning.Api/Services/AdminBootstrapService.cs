using System.ComponentModel.DataAnnotations;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services;

public sealed record AdminBootstrapResult(int UserId, string Email, bool Created);

public sealed class AdminBootstrapService(EnglishLearningDbContext dbContext,
    IPasswordHasher<User> passwordHasher, IOptions<BootstrapAdminOptions> configured)
{
    public async Task<AdminBootstrapResult> InitializeAsync(CancellationToken cancellationToken = default)
    {
        var options = configured.Value;
        Validator.ValidateObject(options, new ValidationContext(options), validateAllProperties: true);
        var email = options.Email.Trim().ToLowerInvariant();
        var existing = await dbContext.Users.AsNoTracking().SingleOrDefaultAsync(user => user.Email == email, cancellationToken);
        if (existing is not null) return Existing(existing);

        var user = new User { Email = email, FullName = options.FullName.Trim(), Role = UserRoles.Admin };
        user.PasswordHash = passwordHasher.HashPassword(user, options.Password);
        dbContext.Users.Add(user);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return new AdminBootstrapResult(user.UserId, user.Email, true);
        }
        catch (DbUpdateException error) when (error.InnerException is SqlException { Number: 2601 or 2627 })
        {
            dbContext.Entry(user).State = EntityState.Detached;
            existing = await dbContext.Users.AsNoTracking().SingleOrDefaultAsync(item => item.Email == email, cancellationToken);
            if (existing is null) throw;
            return Existing(existing);
        }
    }

    private static AdminBootstrapResult Existing(User user)
    {
        if (user.Role != UserRoles.Admin)
            throw new InvalidOperationException("Bootstrap email belongs to a regular user. No role or password was changed.");
        if (!user.IsActive)
            throw new InvalidOperationException("Bootstrap admin is inactive. No account was reactivated.");
        return new AdminBootstrapResult(user.UserId, user.Email, false);
    }
}
