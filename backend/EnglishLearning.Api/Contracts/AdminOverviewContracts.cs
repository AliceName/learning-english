namespace EnglishLearning.Api.Contracts;

/// <summary>Counts for the admin overview. Learner counts leave out admins and test accounts (see <c>AdminOverviewService</c>).</summary>
public sealed record AdminOverviewActivity(
    int LearnersToday, int Learners7Days, int Learners30Days,
    int NewAccounts7Days, int NewAccounts30Days,
    int Essays7Days, int Revisions7Days, int Essays30Days,
    int? AiCalls7Days, int? AiErrors7Days);

public sealed record AdminOverviewDay(DateOnly Date, int Learners);
public sealed record AdminOverviewSkill(string Kind, int Learners);
public sealed record AdminOverviewAttention(string Kind, int Count, string Href);

public sealed record AdminOverview(
    DateTimeOffset GeneratedAt, DateOnly Today,
    int CountedLearners, int ExcludedAccounts,
    AdminOverviewActivity Activity, IReadOnlyList<AdminOverviewDay> Daily, IReadOnlyList<AdminOverviewSkill> Skills,
    IReadOnlyList<AdminOverviewAttention> Attention, IReadOnlyList<AdminAuditEntry> Recent);

/// <summary>Status: ok | down | unconfigured | configured (an outside provider with a key that is not called from here).</summary>
public sealed record AdminServiceStatus(string Key, string Name, string Status, int? LatencyMs, string Detail);
public sealed record AdminServiceReport(DateTimeOffset CheckedAt, IReadOnlyList<AdminServiceStatus> Services);
