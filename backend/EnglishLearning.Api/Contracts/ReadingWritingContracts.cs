using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public sealed class WritingCriterion
{
    [Required, StringLength(100)] public string Name { get; init; } = "";
    [StringLength(2000)] public string Description { get; init; } = "";
    [Range(1,100)] public int Weight { get; init; } = 25;
}
public sealed class WritingContent : IValidatableObject
{
    [Required, RegularExpression("^(essay|email|paragraph|report|proposal)$")] public string TaskType { get; init; } = "essay";
    [StringLength(255)] public string Topic { get; init; } = "";
    [StringLength(10000)] public string Prompt { get; init; } = "";
    [StringLength(5000)] public string Instructions { get; init; } = "";
    [Range(1,5000)] public int MinWords { get; init; } = 150;
    [Range(1,5000)] public int MaxWords { get; init; } = 300;
    [StringLength(30000)] public string SampleAnswer { get; init; } = "";
    [Required, MaxLength(8)] public WritingCriterion[] Rubric { get; init; } = [];
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (MinWords > MaxWords)
            yield return new ValidationResult("Số từ tối thiểu không được lớn hơn số từ tối đa.", [nameof(MaxWords)]);
        if (Rubric?.Any(item => item is null) == true)
            yield return new ValidationResult("Tiêu chí đánh giá không được null.", [nameof(Rubric)]);
        else if (Rubric is {Length:>0} && Rubric.Sum(item=>item.Weight)!=100)
            yield return new ValidationResult("Tổng trọng số các tiêu chí phải bằng 100%.", [nameof(Rubric)]);
    }
}
public sealed class ReadingVocabulary
{
    [Required, StringLength(100)] public string Word { get; init; } = "";
    [Required, StringLength(500)] public string Meaning { get; init; } = "";
    [StringLength(1000)] public string Example { get; init; } = "";
}
public sealed class ReadingQuestion : IValidatableObject
{
    [Required, RegularExpression("^(multiple_choice|fill_blank|short_answer|true_false_not_given|matching)$")] public string Type { get; init; } = "multiple_choice";
    [Required, StringLength(2000)] public string Prompt { get; init; } = "";
    [Required, MaxLength(4, ErrorMessage = "Chỉ được có tối đa 4 lựa chọn.")] public string[] Options { get; init; } = [];
    public int? CorrectOptionIndex { get; init; }
    [StringLength(500)] public string? Answer { get; init; }
    [Required, MaxLength(10)] public string[] AcceptedAnswers { get; init; } = [];
    public bool CaseSensitive { get; init; }
    [StringLength(2000)] public string? Explanation { get; init; }
    [StringLength(1000)] public string? Reference { get; init; }
    [Required, RegularExpression("^(skimming|scanning|inference|vocabulary)$")] public string Focus { get; init; } = "scanning";
    [Range(typeof(decimal), "0.1", "10")] public decimal Points { get; init; } = 1;
    [Required, MaxLength(8)] public MatchingPair[] Pairs { get; init; } = [];
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (Type=="multiple_choice" && (Options is null || Options.Length<2 || Options.Length>4 || Options.Any(item=>string.IsNullOrWhiteSpace(item)||item.Length>500)
            || CorrectOptionIndex is null || CorrectOptionIndex<0 || CorrectOptionIndex>=Options.Length))
            yield return new ValidationResult("Trắc nghiệm cần 2–4 lựa chọn và một đáp án đúng.", [nameof(Options)]);
        if (Type=="fill_blank" && (string.IsNullOrWhiteSpace(Answer)||!Prompt.Contains("[blank]",StringComparison.Ordinal)))
            yield return new ValidationResult("Câu điền từ cần [blank] và đáp án.", [nameof(Answer)]);
        if (Type=="short_answer" && string.IsNullOrWhiteSpace(Answer))
            yield return new ValidationResult("Câu trả lời ngắn cần đáp án chuẩn.", [nameof(Answer)]);
        if (AcceptedAnswers?.Any(item=>string.IsNullOrWhiteSpace(item)||item.Length>500)==true)
            yield return new ValidationResult("Đáp án thay thế cần 1–500 ký tự.", [nameof(AcceptedAnswers)]);
        if (Type=="true_false_not_given" && Answer is not ("true" or "false" or "not_given"))
            yield return new ValidationResult("Chọn đáp án True, False hoặc Not Given.", [nameof(Answer)]);
        if (Type=="matching" && (Pairs is null || Pairs.Length<2 || Pairs.Any(pair=>pair is null)))
            yield return new ValidationResult("Câu nối ý cần ít nhất hai cặp.", [nameof(Pairs)]);
    }
}
public sealed class ReadingContent : IValidatableObject
{
    [StringLength(255)] public string PassageTitle { get; init; } = "";
    [StringLength(255)] public string Category { get; init; } = "";
    [StringLength(30000)] public string Passage { get; init; } = "";
    [StringLength(30000)] public string Translation { get; init; } = "";
    [StringLength(3000)] public string Instructions { get; init; } = "";
    [Required, MaxLength(30)] public ReadingVocabulary[] Vocabulary { get; init; } = [];
    [Required, MaxLength(30)] public ReadingQuestion[] Questions { get; init; } = [];
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (Vocabulary?.Any(item=>item is null)==true)
            yield return new ValidationResult("Từ vựng không được null.",[nameof(Vocabulary)]);
        if (Questions?.Any(item=>item is null)==true)
            yield return new ValidationResult("Câu hỏi không được null.",[nameof(Questions)]);
    }
}
