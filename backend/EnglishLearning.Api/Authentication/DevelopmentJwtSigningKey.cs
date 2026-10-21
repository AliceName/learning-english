using System.Security.Cryptography;
using System.Text.Json;

namespace EnglishLearning.Api.Authentication;

public static class DevelopmentJwtSigningKey
{
    public static void EnsureConfigured(IConfiguration configuration, string secretsPath)
    {
        if (!string.IsNullOrWhiteSpace(configuration["Jwt:SigningKey"]))
            return;

        using var secrets = new ConfigurationManager();
        secrets.AddJsonFile(secretsPath, optional: true, reloadOnChange: false);

        var signingKey = secrets["Jwt:SigningKey"];
        if (string.IsNullOrWhiteSpace(signingKey))
        {
            signingKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));
            var values = secrets.AsEnumerable()
                .Where(entry => entry.Value is not null)
                .ToDictionary(entry => entry.Key, entry => entry.Value, StringComparer.OrdinalIgnoreCase);
            values["Jwt:SigningKey"] = signingKey;

            Directory.CreateDirectory(Path.GetDirectoryName(secretsPath)!);
            File.WriteAllText(secretsPath,
                JsonSerializer.Serialize(values, new JsonSerializerOptions { WriteIndented = true }));
        }

        // Apply the persisted key even if the default Development provider did
        // not load it, without changing any other effective configuration.
        configuration["Jwt:SigningKey"] = signingKey;
    }
}
