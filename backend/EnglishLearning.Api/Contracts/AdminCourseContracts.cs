using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public class SaveCourseRequest
{
    [Required, StringLength(255)] public string Title { get; init; } = "";
    [StringLength(10000)] public string? Description { get; init; }
    [StringLength(500), MediaUrl] public string? CoverImageUrl { get; init; }
}

public sealed class CreateCourseRequest : SaveCourseRequest, IValidatableObject
{
    [Required, RegularExpression("^(A1|A2|B1|B2|C1|C2)$")] public string DifficultyLevel { get; init; } = "B1";
    [Range(1, 600)] public int EstimatedMinutes { get; init; } = 20;
    [Required, MinLength(1), MaxLength(5)] public string[] Skills { get; init; } = ["speaking"];
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (Skills is not null && (Skills.Distinct().Count() != Skills.Length || Skills.Any(skill => skill is not ("speaking" or "listening" or "grammar" or "writing" or "reading"))))
            yield return new ValidationResult("Chọn Speaking, Listening, Grammar, Writing hoặc Reading, không trùng lặp.", [nameof(Skills)]);
    }
}

public sealed class AdminCourseQuery
{
    [StringLength(200)] public string? Search { get; init; }
    [Range(1, 10000)] public int Page { get; init; } = 1;
    [Range(1, 24)] public int PageSize { get; init; } = 12;
}

public sealed class SpeakingSentence
{
    [Required, StringLength(1000)] public string Text { get; init; } = "";
    [StringLength(8000)] public string? Ipa { get; init; }
    [StringLength(500), MediaUrl] public string? AudioUrl { get; init; }
}
public sealed class SpeakingContent : IValidatableObject
{
    [StringLength(3000)] public string Goals { get; init; } = "";
    [Required, MaxLength(30)] public SpeakingSentence[] Sentences { get; init; } = [];
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (Sentences?.Any(sentence => sentence is null) == true)
            yield return new ValidationResult("Câu luyện nói không được null.", [nameof(Sentences)]);
    }
}
public sealed class MatchingPair
{
    [Required, StringLength(500)] public string Left { get; init; } = "";
    [Required, StringLength(500)] public string Right { get; init; } = "";
}
public sealed class ListeningQuestion : IValidatableObject
{
    [Required, RegularExpression("^(multiple_choice|fill_blank|matching)$")] public string Type { get; init; } = "multiple_choice";
    [Required, StringLength(2000)] public string Prompt { get; init; } = "";
    [MaxLength(4, ErrorMessage = "Chỉ được có tối đa 4 lựa chọn.")] public string[] Options { get; init; } = [];
    public int? CorrectOptionIndex { get; init; }
    [StringLength(500)] public string? Answer { get; init; }
    public bool CaseSensitive { get; init; }
    [StringLength(2000)] public string? Explanation { get; init; }
    [Range(0, 86400)] public int? AtSeconds { get; init; }
    [MaxLength(8)] public MatchingPair[] Pairs { get; init; } = [];
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (Type == "multiple_choice" && (Options is null || Options.Length < 2 || Options.Length > 4 || Options.Any(value => string.IsNullOrWhiteSpace(value) || value.Length > 500) || CorrectOptionIndex is null || CorrectOptionIndex < 0 || CorrectOptionIndex >= Options.Length))
            yield return new ValidationResult("Trắc nghiệm cần 2–4 lựa chọn và một đáp án đúng.", [nameof(Options)]);
        if (Type == "fill_blank" && (string.IsNullOrWhiteSpace(Answer) || !Prompt.Contains("[blank]", StringComparison.Ordinal)))
            yield return new ValidationResult("Câu điền từ cần [blank] và đáp án.", [nameof(Answer)]);
        if (Type == "matching" && (Pairs is null || Pairs.Length < 2 || Pairs.Any(pair => pair is null)))
            yield return new ValidationResult("Câu nối ý cần ít nhất hai cặp.", [nameof(Pairs)]);
    }
}
public sealed class ListeningContent : IValidatableObject
{
    [StringLength(20000)] public string Transcript { get; init; } = "";
    public bool HideTranscriptFirstListen { get; init; } = true;
    [Required, MaxLength(30)] public ListeningQuestion[] Questions { get; init; } = [];
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (Questions?.Any(question => question is null) == true)
            yield return new ValidationResult("Câu hỏi không được null.", [nameof(Questions)]);
    }
}
public sealed class GrammarQuestion : IValidatableObject
{
    [Required, RegularExpression("^(multiple_choice|fill_blank|error_correction)$")] public string Type { get; init; } = "multiple_choice";
    [Required, StringLength(2000)] public string Prompt { get; init; } = "";
    [MaxLength(4, ErrorMessage = "Chỉ được có tối đa 4 lựa chọn.")] public string[] Options { get; init; } = [];
    public int? CorrectOptionIndex { get; init; }
    [StringLength(500)] public string? Answer { get; init; }
    [Required, MaxLength(10)] public string[] AcceptedAnswers { get; init; } = [];
    public bool CaseSensitive { get; init; }
    [StringLength(1000)] public string? Correction { get; init; }
    [StringLength(250)] public string? Tag { get; init; }
    [StringLength(2000)] public string? Explanation { get; init; }
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if ((Type is "multiple_choice" or "error_correction") &&
            (Options is null || Options.Length < 2 || Options.Length > 4 || Options.Any(value => string.IsNullOrWhiteSpace(value) || value.Length > 500)
                || CorrectOptionIndex is null || CorrectOptionIndex < 0 || CorrectOptionIndex >= Options.Length))
            yield return new ValidationResult("Cần 2–4 lựa chọn và một đáp án đúng.", [nameof(Options)]);
        if (Type == "fill_blank" && (string.IsNullOrWhiteSpace(Answer) || !Prompt.Contains("[blank]", StringComparison.Ordinal)))
            yield return new ValidationResult("Câu điền từ cần [blank] và đáp án chính xác.", [nameof(Answer)]);
        if (AcceptedAnswers?.Any(answer => string.IsNullOrWhiteSpace(answer) || answer.Length > 500) == true)
            yield return new ValidationResult("Mỗi đáp án thay thế cần 1–500 ký tự.", [nameof(AcceptedAnswers)]);
        if (Type == "error_correction" && string.IsNullOrWhiteSpace(Correction))
            yield return new ValidationResult("Câu sửa lỗi cần cách sửa đúng.", [nameof(Correction)]);
    }
}
public sealed class GrammarContent : IValidatableObject
{
    [StringLength(255)] public string Topic { get; init; } = "";
    [StringLength(20000)] public string Rules { get; init; } = "";
    [StringLength(3000)] public string CommonMistakes { get; init; } = "";
    [Required, MaxLength(30)] public GrammarQuestion[] Questions { get; init; } = [];
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (Questions?.Any(question => question is null) == true)
            yield return new ValidationResult("Câu hỏi không được null.", [nameof(Questions)]);
    }
}
public sealed class SaveLessonRequest : IValidatableObject
{
    [Required, StringLength(255)] public string Title { get; init; } = "";
    [Required, RegularExpression("^(speaking|listening|grammar|writing|reading)$")] public string SkillType { get; init; } = "speaking";
    [Required, RegularExpression("^(A1|A2|B1|B2|C1|C2)$")] public string DifficultyLevel { get; init; } = "B1";
    [Range(1, 600)] public int EstimatedMinutes { get; init; } = 20;
    public bool IsActive { get; init; } = true;
    [StringLength(500), MediaUrl] public string? AudioUrl { get; init; }
    public SpeakingContent? Speaking { get; init; }
    public ListeningContent? Listening { get; init; }
    public GrammarContent? Grammar { get; init; }
    public WritingContent? Writing { get; init; }
    public ReadingContent? Reading { get; init; }
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        var matches = SkillType switch
        {
            "speaking" => Speaking is not null && Listening is null && Grammar is null && Writing is null && Reading is null,
            "listening" => Listening is not null && Speaking is null && Grammar is null && Writing is null && Reading is null,
            "grammar" => Grammar is not null && Speaking is null && Listening is null && Writing is null && Reading is null && AudioUrl is null,
            "writing" => Writing is not null && Speaking is null && Listening is null && Grammar is null && Reading is null && AudioUrl is null,
            "reading" => Reading is not null && Speaking is null && Listening is null && Grammar is null && Writing is null && AudioUrl is null,
            _ => false
        };
        if (!matches)
            yield return new ValidationResult("Nội dung phải khớp kỹ năng bài học.", [nameof(SkillType)]);
    }
}
public sealed class MediaUrlAttribute : ValidationAttribute
{
    public MediaUrlAttribute() => ErrorMessage = "Dùng URL http/https hoặc tệp đã tải lên hệ thống.";
    public override bool IsValid(object? value) => value is null || value is string text &&
        (string.IsNullOrEmpty(text) || System.Text.RegularExpressions.Regex.IsMatch(text, @"^/api/media/[a-f0-9]{32}\.(jpg|jpeg|png|webp|mp3|wav|aac|m4a)$") ||
        Uri.TryCreate(text, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" && string.IsNullOrEmpty(uri.UserInfo));
}
public sealed record LessonContentDocument(int Version, SpeakingContent? Speaking, ListeningContent? Listening, GrammarContent? Grammar = null, WritingContent? Writing = null, ReadingContent? Reading = null);
public sealed record AdminLessonResponse(int LessonId, string Title, string SkillType, string? DifficultyLevel,
    int? EstimatedMinutes, int OrderIndex, bool IsActive, string? AudioUrl, SpeakingContent? Speaking, ListeningContent? Listening, bool ContentSupported, GrammarContent? Grammar = null, WritingContent? Writing = null, ReadingContent? Reading = null);
public sealed record AdminCourseResponse(int CourseId, string Title, string? Description, string? CoverImageUrl,
    bool IsPublished, DateTime UpdatedAt, IReadOnlyList<AdminLessonResponse> Lessons);
public sealed record AdminCourseListItem(int CourseId, string Title, string? CoverImageUrl, bool IsPublished, int LessonCount, DateTime UpdatedAt);
public sealed record AdminCourseListResponse(IReadOnlyList<AdminCourseListItem> Items, int TotalCount, int Page, int PageSize, int TotalPages);
public sealed record UploadedMediaResponse(string Url, string FileName, long Size, string ContentType);
