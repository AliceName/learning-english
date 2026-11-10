using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Entities;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace EnglishLearning.Api.Authentication;

public sealed class JwtTokenService(IOptions<JwtOptions> options, TimeProvider timeProvider)
{
    public LoginResponse CreateToken(User user, RefreshGrant? session = null)
    {
        var settings = options.Value;
        var now = session?.IssuedAt ?? timeProvider.GetUtcNow();
        var expiresAt = now.AddMinutes(settings.AccessTokenMinutes);
        var claims = new List<Claim>
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.UserId.ToString(CultureInfo.InvariantCulture)),
            new Claim(JwtRegisteredClaimNames.Email, user.Email),
            new Claim("name", user.FullName),
            new Claim(UserRoles.ClaimType, user.Role),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N")),
            new Claim(JwtRegisteredClaimNames.Iat, now.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture), ClaimValueTypes.Integer64)
        };
        if (session is not null)
        {
            if (session.ExpiresAt < expiresAt) expiresAt = session.ExpiresAt;
            claims.Add(new Claim(RefreshSessions.SessionClaim, session.SessionId.ToString("N")));
            claims.Add(new Claim(RefreshSessions.DeadlineClaim, session.ExpiresAt.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture), ClaimValueTypes.Integer64));
        }
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.SigningKey)), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(settings.Issuer, settings.Audience, claims,
            now.UtcDateTime, expiresAt.UtcDateTime, credentials);
        return new LoginResponse(new JwtSecurityTokenHandler().WriteToken(token), "Bearer",
            Math.Max(1, (int)Math.Ceiling((expiresAt - now).TotalSeconds)), expiresAt,
            new RegisteredUser(user.UserId, user.Email, user.FullName, user.TargetLevel, user.CreatedAt, user.Role), session?.Token);
    }
}
