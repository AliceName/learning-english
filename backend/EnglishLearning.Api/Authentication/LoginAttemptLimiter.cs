using System.Threading.RateLimiting;

namespace EnglishLearning.Api.Authentication;

public sealed class LoginAttemptLimiter : IDisposable
{
    private readonly PartitionedRateLimiter<string> limiter = PartitionedRateLimiter.Create<string, string>(
        email => RateLimitPartition.GetFixedWindowLimiter(email, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 30,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        }));

    public RateLimitLease Attempt(string normalizedEmail) => limiter.AttemptAcquire(normalizedEmail);

    public void Dispose() => limiter.Dispose();
}
