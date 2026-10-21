using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Authentication;

public sealed class BootstrapAdminOptions
{
    public const string SectionName = "BootstrapAdmin";

    [Required, EmailAddress, StringLength(255)]
    public string Email { get; set; } = "admin@linguaai.local";

    [Required, StringLength(150)]
    public string FullName { get; set; } = "Quản trị viên";

    [Required, StringLength(128, MinimumLength = 12)]
    public string Password { get; set; } = string.Empty;
}
