using System.ComponentModel.DataAnnotations;
using System.Text.RegularExpressions;

namespace EnglishLearning.Api.Contracts;

public sealed class PersonalDetails : IValidatableObject
{
    private string? phoneNumber;
    private string? address;
    [StringLength(25, ErrorMessage = "Số điện thoại tối đa 25 ký tự.")]
    public string? PhoneNumber { get => phoneNumber; init => phoneNumber = Clean(value); }
    public DateOnly? DateOfBirth { get; init; }
    [StringLength(500, ErrorMessage = "Địa chỉ tối đa 500 ký tự.")]
    public string? Address { get => address; init => address = Clean(value); }

    [System.Text.Json.Serialization.JsonIgnore]
    public string? NormalizedPhone => PhoneNumber is null ? null : Regex.Replace(PhoneNumber, @"[ ()\-]", "");

    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (PhoneNumber is not null && !Regex.IsMatch(PhoneNumber, @"^\+?[0-9 ()\-]+$") ||
            NormalizedPhone is not null && !Regex.IsMatch(NormalizedPhone, @"^\+?[0-9]{8,15}$"))
            yield return new("Nhập số điện thoại gồm 8–15 chữ số, có thể bắt đầu bằng +.", [nameof(PhoneNumber)]);
        var clock = context.GetService(typeof(TimeProvider)) as TimeProvider ?? TimeProvider.System;
        var today = DateOnly.FromDateTime(clock.GetUtcNow().ToOffset(TimeSpan.FromHours(7)).DateTime);
        if (DateOfBirth is { } birth && (birth < new DateOnly(1900, 1, 1) || birth > today))
            yield return new("Ngày sinh phải từ năm 1900 đến hôm nay.", [nameof(DateOfBirth)]);
        if (Address?.Any(char.IsControl) == true)
            yield return new("Địa chỉ không được chứa ký tự điều khiển.", [nameof(Address)]);
    }

    internal static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

public sealed class LearningPreferences
{
    private string? learningPurpose;
    private string? preferredSkill;
    [RegularExpression("^(communication|work|study|exam)$", ErrorMessage = "Chọn mục đích học trong danh sách.")]
    public string? LearningPurpose { get => learningPurpose; init => learningPurpose = PersonalDetails.Clean(value); }
    [RegularExpression("^(speaking|listening|writing|reading|grammar)$", ErrorMessage = "Chọn kỹ năng trong danh sách.")]
    public string? PreferredSkill { get => preferredSkill; init => preferredSkill = PersonalDetails.Clean(value); }
    [Range(5, 180, ErrorMessage = "Mục tiêu mỗi ngày từ 5 đến 180 phút.")]
    public int? DailyGoalMinutes { get; init; }
}
