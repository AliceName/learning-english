using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public sealed class ChangePasswordRequest : IValidatableObject
{
    [Required(ErrorMessage = "Nhập mật khẩu hiện tại.")]
    [StringLength(128)]
    public string CurrentPassword { get; init; } = "";
    [Required(ErrorMessage = "Nhập mật khẩu mới.")]
    [StringLength(128, MinimumLength = 8, ErrorMessage = "Mật khẩu mới phải có từ 8 đến 128 ký tự.")]
    public string NewPassword { get; init; } = "";
    [Required(ErrorMessage = "Nhập lại mật khẩu mới.")]
    [Compare(nameof(NewPassword), ErrorMessage = "Mật khẩu xác nhận không khớp.")]
    public string ConfirmPassword { get; init; } = "";
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (CurrentPassword == NewPassword)
            yield return new("Mật khẩu mới phải khác mật khẩu hiện tại.", [nameof(NewPassword)]);
    }
}

public sealed record RevokeOtherSessionsRequest([StringLength(128)] string? RefreshToken = null);
