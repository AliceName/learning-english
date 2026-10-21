using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

public sealed class LoginService(EnglishLearningDbContext dbContext, IPasswordHasher<User> passwordHasher)
{
    // Unknown and disabled users still perform password hashing to reduce account-enumeration timing differences.
    private static readonly User DummyUser = new();
    private static readonly string DummyHash = new PasswordHasher<User>().HashPassword(DummyUser, Guid.NewGuid().ToString("N"));

    public async Task<User?> AuthenticateAsync(LoginRequest request, CancellationToken cancellationToken)
    {
        var user = await dbContext.Users.SingleOrDefaultAsync(item => item.Email == request.Email, cancellationToken);
        if (user is null || !user.IsActive)
        {
            passwordHasher.VerifyHashedPassword(DummyUser, DummyHash, request.Password);
            return null;
        }

        PasswordVerificationResult result;
        try
        {
            result = passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
        }
        catch (Exception error) when (error is FormatException or ArgumentException)
        {
            passwordHasher.VerifyHashedPassword(DummyUser, DummyHash, request.Password);
            return null;
        }

        if (result == PasswordVerificationResult.Failed) return null;
        if (result == PasswordVerificationResult.SuccessRehashNeeded)
        {
            user.PasswordHash = passwordHasher.HashPassword(user, request.Password);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        return user;
    }
}
