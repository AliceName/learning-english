using System.Text.RegularExpressions;
using CloudinaryDotNet;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Configuration;

public sealed class CloudinarySettings
{
    public const string SectionName = "Cloudinary";
    // Enables new dictionary/course media writes to cloud; legacy files remain read-only.
    public bool Enabled { get; set; }
    // Explicit rollback switch only; normal runtime never falls back to local files.
    public bool AllowLegacyReads { get; set; }
    public string CloudName { get; set; } = "";
    public string ApiKey { get; set; } = "";
    public string ApiSecret { get; set; } = "";
    public string EnvironmentPrefix { get; set; } = "els/dev";
    public int UploadTimeoutSeconds { get; set; } = 30;
    public int ReadTimeoutSeconds { get; set; } = 20;
}

public sealed class CloudinarySettingsValidator : IValidateOptions<CloudinarySettings>
{
    public ValidateOptionsResult Validate(string? name, CloudinarySettings value)
    {
        if (!value.Enabled) return ValidateOptionsResult.Success;
        var errors = new List<string>();
        if (!Regex.IsMatch(value.CloudName ?? "", @"\A[a-zA-Z0-9_-]{1,100}\z")) errors.Add("Configure Cloudinary:CloudName through secrets.");
        if (!Regex.IsMatch(value.ApiKey ?? "", @"\A[0-9]{5,40}\z")) errors.Add("Configure Cloudinary:ApiKey through secrets.");
        if (string.IsNullOrWhiteSpace(value.ApiSecret) || value.ApiSecret.Length < 8 || value.ApiSecret.Any(char.IsWhiteSpace))
            errors.Add("Configure Cloudinary:ApiSecret through secrets.");
        if (!Regex.IsMatch(value.EnvironmentPrefix ?? "", @"\Aels/(dev|test|prod)(/[a-z0-9][a-z0-9-]{0,31}){0,2}\z"))
            errors.Add("Cloudinary:EnvironmentPrefix must be els/dev, els/test or els/prod with optional safe path segments.");
        if (value.UploadTimeoutSeconds is < 5 or > 120) errors.Add("Cloudinary:UploadTimeoutSeconds must be between 5 and 120.");
        if (value.ReadTimeoutSeconds is < 5 or > 60) errors.Add("Cloudinary:ReadTimeoutSeconds must be between 5 and 60.");
        return errors.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(errors);
    }

    public static void EnsureEnabledAndValid(CloudinarySettings settings)
    {
        if (!settings.Enabled) throw new OptionsValidationException(CloudinarySettings.SectionName, typeof(CloudinarySettings), ["Enable Cloudinary:Enabled after configuring secrets."]);
        var result = new CloudinarySettingsValidator().Validate(null, settings);
        if (result.Failed) throw new OptionsValidationException(CloudinarySettings.SectionName, typeof(CloudinarySettings), result.Failures);
    }
}

public static class CloudinaryClientFactory
{
    public static Cloudinary Create(CloudinarySettings settings)
    {
        CloudinarySettingsValidator.EnsureEnabledAndValid(settings);
        var client = new Cloudinary(new Account(settings.CloudName, settings.ApiKey, settings.ApiSecret));
        client.Api.Secure = true;
        client.Api.Timeout = checked(settings.UploadTimeoutSeconds * 1000);
        return client;
    }
}
