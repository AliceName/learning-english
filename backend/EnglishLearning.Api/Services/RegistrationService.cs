using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

public sealed class RegistrationService(
    EnglishLearningDbContext dbContext,
    IPasswordHasher<User> passwordHasher)
{
    public async Task<User?> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken)
    {
        if (await dbContext.Users.AnyAsync(user => user.Email == request.Email, cancellationToken))
        {
            return null;
        }

        var user = new User
        {
            Email = request.Email,
            FullName = request.FullName,
            TargetLevel = request.TargetLevel,
            Role = UserRoles.User
        };
        user.PasswordHash = passwordHasher.HashPassword(user, request.Password);
        dbContext.Users.Add(user);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return user;
        }
        catch (DbUpdateException error) when (
            error.InnerException is SqlException { Number: 2601 or 2627 })
        {
            // The database also protects against simultaneous sign-ups with the same email.
            return null;
        }
    }
}
