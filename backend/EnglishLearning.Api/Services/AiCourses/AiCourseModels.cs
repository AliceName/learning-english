using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Services.AiCourses;

public sealed class AiCourseException(int status, string code, string message, int? retryAfter = null, bool retryable = false) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public int? RetryAfter { get; } = retryAfter;
    public bool Retryable { get; } = retryable;
    public Guid? OperationId { get; init; }
    public AiContentIssue[] ContentIssues { get; init; } = [];
}

public sealed class AiCourseConfig : IValidatableObject
{
    [Required, StringLength(1000, MinimumLength = 5)] public string Goal { get; set; } = "";
    [Required, RegularExpression("^(A1|A2|B1|B2|C1|C2)$")] public string DifficultyLevel { get; set; } = "B1";
    [Range(1, 3)] public int LessonCount { get; set; } = 1;
    // Existing persisted pilot jobs omitted Skills and contain listening lessons only.
    [Required, MinLength(1), MaxLength(5)] public string[] Skills { get; set; } = ["listening"];
    [Range(3, 5)] public int QuestionsPerLesson { get; set; } = 3;
    [Range(30, 120)] public int TargetAudioSeconds { get; set; } = 60;
    [Required, RegularExpression("^(Kore|Puck|Aoede|Charon)$")] public string Voice { get; set; } = "Kore";
    public int TotalLessons => LessonCount * (Skills?.Length ?? 0);
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (Skills is not null && (Skills.Distinct().Count() != Skills.Length || Skills.Any(skill => !AiCourseContent.Skills.Contains(skill))))
            yield return new ValidationResult("Chọn kỹ năng hợp lệ, không trùng lặp.", [nameof(Skills)]);
    }
}

public sealed class AiOutlineLesson
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Title { get; set; } = "";
    public string Objective { get; set; } = "";
    public string SkillType { get; set; } = "listening";
    public ListeningContent? Listening { get; set; }
    public SpeakingContent? Speaking { get; set; }
    public ReadingContent? Reading { get; set; }
    public WritingContent? Writing { get; set; }
    public GrammarContent? Grammar { get; set; }
    public string? AudioFileName { get; set; }
    public decimal? AudioSeconds { get; set; }
    public bool HasContent => SkillType switch {
        "listening" => Listening is not null, "speaking" => Speaking is not null,
        "reading" => Reading is not null, "writing" => Writing is not null, "grammar" => Grammar is not null, _ => false
    };
    public bool IsComplete => HasContent && (SkillType != "listening" || AudioFileName is not null);
}

public sealed class AiCourseOutline
{
    public string Summary { get; set; } = "";
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public AiOutlineLesson[] Lessons { get; set; } = [];
}

public sealed class AiCourseJob
{
    public Guid Id { get; set; }
    public int UserId { get; set; }
    public string Fingerprint { get; set; } = "";
    public string OriginalFileName { get; set; } = "";
    public string FileType { get; set; } = "";
    public string? SourceText { get; set; }
    public AiCourseConfig Config { get; set; } = new();
    // Old single-skill workers must not claim and rewrite a multi-skill task.
    public int ProtocolVersion { get; set; } = 1;
    [JsonPropertyName("status")] public string StoredStatus { get; set; } = "queued";
    [JsonIgnore] public string Status {
        get => StoredStatus.StartsWith("v2:", StringComparison.Ordinal) ? StoredStatus[3..] : StoredStatus;
        set => StoredStatus = (ProtocolVersion >= 2 ? "v2:" : "") + value;
    }
    public string? ErrorCode { get; set; }
    public string? Error { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? NextAttemptAt { get; set; }
    public Guid? RetryOperationId { get; set; }
    public int TransientRetryCount { get; set; }
    public AiCourseOutline? Outline { get; set; }
    public int OutlineRevision { get; set; }
    public int? CourseId { get; set; }
}

public sealed record AiOutlineUpdate(int Revision, string Title, string Description, AiOutlineEdit[] Lessons);
public sealed record AiOutlineEdit(Guid Id, string Title, string Objective);
public sealed record AiCourseRevision(int Revision);
public sealed record AiCourseActivate(int Revision);

public sealed class AiApiPolicy
{
    public int Version { get; set; } = 1;
    public bool Enabled { get; set; } = true;
    [Range(1, 100)] public int RequestsPerMinute { get; set; } = 10;
    [Range(1, 10000)] public int CallsPerDay { get; set; } = 100;
    [Range(1, 1000)] public int CallsPerUserPerDay { get; set; } = 30;
    [Range(1000, 10000000)] public long TokensPerDay { get; set; } = 500_000;
    public DateTimeOffset? CooldownUntil { get; set; }
}

public sealed record AiPolicyUpdate(int Version, bool Enabled, int RequestsPerMinute,
    int CallsPerDay, int CallsPerUserPerDay, long TokensPerDay, string Reason);

public sealed class AiApiCall
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OperationId { get; set; }
    public Guid? GenerationId { get; set; }
    public int? UserId { get; set; }
    public string Feature { get; set; } = "";
    public string Operation { get; set; } = "";
    public string Model { get; set; } = "";
    public int AttemptNo { get; set; }
    public int PolicyVersion { get; set; }
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FinishedAt { get; set; }
    public int? HttpStatus { get; set; }
    public string Outcome { get; set; } = "started";
    public string ContentOutcome { get; set; } = "unchecked";
    public string? ContentFailureCode { get; set; }
    public string? ContentFailurePath { get; set; }
    public string? ProviderFinishReason { get; set; }
    public string? ErrorCode { get; set; }
    public long ReservedTokens { get; set; }
    public long? InputTokens { get; set; }
    public long? OutputTokens { get; set; }
    public long? ThoughtTokens { get; set; }
    public long? TotalTokens { get; set; }
    public int? InputCharacters { get; set; }
    public decimal? AudioSeconds { get; set; }
}

public sealed record AiCallContext(Guid OperationId, Guid? GenerationId, int? UserId,
    string Feature, string Operation, string Model, long ReservedTokens, int? InputCharacters = null);
