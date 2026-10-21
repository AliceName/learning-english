using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public sealed class RegisterRequest
{
    private string email = string.Empty;
    private string fullName = string.Empty;
    private string? targetLevel;

    [Required(ErrorMessage = "Vui lòng nhập địa chỉ email.")]
    [EmailAddress(ErrorMessage = "Địa chỉ email không hợp lệ.")]
    [StringLength(255, ErrorMessage = "Email không được vượt quá 255 ký tự.")]
    public string Email
    {
        get => email;
        init => email = value?.Trim().ToLowerInvariant() ?? string.Empty;
    }

    [Required(ErrorMessage = "Vui lòng nhập họ và tên.")]
    [StringLength(150, ErrorMessage = "Họ và tên không được vượt quá 150 ký tự.")]
    public string FullName
    {
        get => fullName;
        init => fullName = value?.Trim() ?? string.Empty;
    }

    [Required(ErrorMessage = "Vui lòng nhập mật khẩu.")]
    [StringLength(128, MinimumLength = 8, ErrorMessage = "Mật khẩu phải có từ 8 đến 128 ký tự.")]
    public string Password { get; init; } = string.Empty;

    [Required(ErrorMessage = "Vui lòng xác nhận mật khẩu.")]
    [Compare(nameof(Password), ErrorMessage = "Mật khẩu xác nhận không khớp.")]
    public string ConfirmPassword { get; init; } = string.Empty;

    [RegularExpression("^(A1|A2|B1|B2|C1|C2)$", ErrorMessage = "Mục tiêu CEFR phải nằm trong A1–C2.")]
    public string? TargetLevel
    {
        get => targetLevel;
        init => targetLevel = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
