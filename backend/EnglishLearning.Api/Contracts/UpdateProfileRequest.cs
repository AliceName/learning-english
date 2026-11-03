using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public sealed class UpdateProfileRequest : IValidatableObject
{
    private string fullName = "";
    private string? targetLevel;
    [Required(ErrorMessage = "Vui lòng nhập họ và tên.")]
    [StringLength(150, ErrorMessage = "Họ tên tối đa 150 ký tự.")]
    public string FullName { get => fullName; init => fullName = value?.Trim() ?? ""; }
    [RegularExpression("^(A1|A2|B1|B2|C1|C2)$", ErrorMessage = "Chọn mục tiêu từ A1 đến C2.")]
    public string? TargetLevel { get => targetLevel; init => targetLevel = string.IsNullOrWhiteSpace(value) ? null : value.Trim(); }
    [StringLength(500)]
    public string? AvatarUrl { get; init; }

    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (FullName.Any(char.IsControl))
            yield return new ValidationResult("Họ tên không được chứa ký tự điều khiển.", [nameof(FullName)]);
        if (AvatarUrl is not null && !System.Text.RegularExpressions.Regex.IsMatch(AvatarUrl,
            @"^/avatars/profile-(blue|purple|green|orange|pink|teal)\.svg$", System.Text.RegularExpressions.RegexOptions.CultureInvariant))
            yield return new ValidationResult("Vui lòng chọn ảnh đại diện trong danh sách.", [nameof(AvatarUrl)]);
    }
}
