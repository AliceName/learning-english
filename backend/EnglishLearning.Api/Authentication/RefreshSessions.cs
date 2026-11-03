using System.Security.Cryptography;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Authentication;

public sealed record RefreshGrant(Guid SessionId, string Token, DateTimeOffset IssuedAt, DateTimeOffset ExpiresAt);

public sealed class RefreshSessions(TimeProvider clock, IOptions<JwtOptions> options)
{
    public const string SessionClaim = "sid";
    public const string DeadlineClaim = "session_exp";
    private const int Capacity = 10_000;
    private static readonly TimeSpan IdleLimit = TimeSpan.FromHours(3);
    private static readonly TimeSpan RetryWindow = TimeSpan.FromSeconds(20);

    private readonly object gate = new();
    private readonly Dictionary<Guid, Session> sessions = new();
    private readonly byte[] rotationKey = RandomNumberGenerator.GetBytes(32);

    public RefreshGrant? Create(int userId)
    {
        lock (gate)
        {
            var now = clock.GetUtcNow();
            if (sessions.Count >= Capacity)
            {
                foreach (var id in sessions.Where(item => IsExpired(item.Value, now)).Select(item => item.Key).ToArray())
                    sessions.Remove(id);
                if (sessions.Count >= Capacity) return null;
            }

            var sessionId = Guid.NewGuid();
            var secret = RandomNumberGenerator.GetBytes(32);
            var session = new Session(userId, now.AddHours(options.Value.SessionHours), now, SHA256.HashData(secret));
            sessions.Add(sessionId, session);
            return Grant(sessionId, secret, session, now);
        }
    }

    public int? FindUser(string token)
    {
        if (!TryRead(token, out var id, out var secret)) return null;
        lock (gate)
        {
            var now = clock.GetUtcNow();
            var session = FindSession(id, now);
            return session is not null && Verify(id, session, SHA256.HashData(secret), now)
                ? session.UserId : null;
        }
    }

    public RefreshGrant? Rotate(string token, int userId)
    {
        if (!TryRead(token, out var id, out var secret)) return null;
        lock (gate)
        {
            var now = clock.GetUtcNow();
            var session = FindSession(id, now);
            var hash = SHA256.HashData(secret);
            if (session is null || session.UserId != userId || !Verify(id, session, hash, now)) return null;

            session.LastActivity = now;
            // Requests from different tabs can arrive with the same cookie. Derive the same
            // replacement during the retry window, without storing either credential in plaintext.
            if (session.PreviousHash is not null && now < session.RetryUntil)
            {
                var current = CryptographicOperations.FixedTimeEquals(session.CurrentHash, hash);
                return Grant(id, current ? secret : HMACSHA256.HashData(rotationKey, secret), session, now);
            }

            var replacement = HMACSHA256.HashData(rotationKey, secret);
            session.PreviousHash = session.CurrentHash;
            session.CurrentHash = SHA256.HashData(replacement);
            session.RetryUntil = now + RetryWindow;
            return Grant(id, replacement, session, now);
        }
    }

    public bool Touch(Guid id)
    {
        lock (gate)
        {
            var now = clock.GetUtcNow();
            var session = FindSession(id, now);
            if (session is null) return false;
            session.LastActivity = now;
            return true;
        }
    }

    public void Revoke(string token)
    {
        if (!TryRead(token, out var id, out var secret)) return;
        lock (gate)
        {
            var session = FindSession(id, clock.GetUtcNow());
            if (session is null) return;
            var hash = SHA256.HashData(secret);
            if (CryptographicOperations.FixedTimeEquals(session.CurrentHash, hash) ||
                session.PreviousHash is { } previous && CryptographicOperations.FixedTimeEquals(previous, hash))
                sessions.Remove(id);
        }
    }

    private Session? FindSession(Guid id, DateTimeOffset now)
    {
        if (!sessions.TryGetValue(id, out var session)) return null;
        if (!IsExpired(session, now)) return session;
        sessions.Remove(id);
        return null;
    }

    private bool Verify(Guid id, Session session, byte[] hash, DateTimeOffset now)
    {
        if (CryptographicOperations.FixedTimeEquals(session.CurrentHash, hash)) return true;
        if (session.PreviousHash is not { } previous || !CryptographicOperations.FixedTimeEquals(previous, hash)) return false;
        if (now < session.RetryUntil) return true;
        sessions.Remove(id);
        return false;
    }

    private static bool IsExpired(Session session, DateTimeOffset now) =>
        now >= session.ExpiresAt || now - session.LastActivity >= IdleLimit;

    private static RefreshGrant Grant(Guid id, byte[] secret, Session session, DateTimeOffset now) =>
        new(id, $"{id:N}.{Convert.ToHexString(secret)}", now, session.ExpiresAt);

    private static bool TryRead(string token, out Guid id, out byte[] secret)
    {
        id = default;
        secret = [];
        if (token.Length != 97 || token[32] != '.' || !Guid.TryParseExact(token.AsSpan(0, 32), "N", out id)) return false;
        try { secret = Convert.FromHexString(token.AsSpan(33)); return true; }
        catch (FormatException) { return false; }
    }

    private sealed class Session(int userId, DateTimeOffset expiresAt, DateTimeOffset now, byte[] hash)
    {
        public int UserId { get; } = userId;
        public DateTimeOffset ExpiresAt { get; } = expiresAt;
        public DateTimeOffset LastActivity { get; set; } = now;
        public byte[] CurrentHash { get; set; } = hash;
        public byte[]? PreviousHash { get; set; }
        public DateTimeOffset RetryUntil { get; set; }
    }
}
