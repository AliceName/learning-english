using System.Text.Json;
using EnglishLearning.Api.Authentication;
using Microsoft.Extensions.Configuration;

namespace EnglishLearning.Api.Tests;

public sealed class DevelopmentJwtSigningKeyTests : IDisposable
{
    private readonly string secretsDirectory = Path.Combine(Path.GetTempPath(), $"EnglishLearning-Jwt-{Guid.NewGuid():N}");
    private string SecretsPath => Path.Combine(secretsDirectory, "secrets.json");

    [Fact]
    public void Missing_key_is_generated_and_reused_after_restart()
    {
        using var first = new ConfigurationManager();
        DevelopmentJwtSigningKey.EnsureConfigured(first, SecretsPath);

        var key = first["Jwt:SigningKey"];
        Assert.NotNull(key);
        Assert.Equal(64, Convert.FromBase64String(key).Length);

        using var restarted = new ConfigurationManager();
        DevelopmentJwtSigningKey.EnsureConfigured(restarted, SecretsPath);
        Assert.Equal(key, restarted["Jwt:SigningKey"]);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Existing_secret_is_recovered_without_rewriting_it(bool nested)
    {
        Directory.CreateDirectory(secretsDirectory);
        var json = nested
            ? JsonSerializer.Serialize(new { Jwt = new { SigningKey = TestJwt.SigningKey } })
            : JsonSerializer.Serialize(new Dictionary<string, string> { ["Jwt:SigningKey"] = TestJwt.SigningKey });
        File.WriteAllText(SecretsPath, json);

        using var configuration = new ConfigurationManager();
        DevelopmentJwtSigningKey.EnsureConfigured(configuration, SecretsPath);

        Assert.Equal(TestJwt.SigningKey, configuration["Jwt:SigningKey"]);
        Assert.Equal(json, File.ReadAllText(SecretsPath));
    }

    [Fact]
    public void Creating_key_preserves_other_secrets_and_effective_settings()
    {
        Directory.CreateDirectory(secretsDirectory);
        File.WriteAllText(SecretsPath, """{"ConnectionStrings":{"DefaultConnection":"stored-connection"},"Jwt":{"Issuer":"stored-issuer"}}""");
        using var configuration = new ConfigurationManager();
        configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:DefaultConnection"] = "environment-connection",
            ["Jwt:Issuer"] = "environment-issuer"
        });

        DevelopmentJwtSigningKey.EnsureConfigured(configuration, SecretsPath);

        using var persisted = new ConfigurationManager();
        persisted.AddJsonFile(SecretsPath);
        Assert.Equal("stored-connection", persisted["ConnectionStrings:DefaultConnection"]);
        Assert.Equal("stored-issuer", persisted["Jwt:Issuer"]);
        Assert.Equal("environment-connection", configuration["ConnectionStrings:DefaultConnection"]);
        Assert.Equal("environment-issuer", configuration["Jwt:Issuer"]);
    }

    [Theory]
    [InlineData(TestJwt.SigningKey)]
    [InlineData("too-short")]
    public void Explicit_key_is_preserved_for_normal_validation(string key)
    {
        using var configuration = new ConfigurationManager();
        configuration.AddInMemoryCollection(
            new Dictionary<string, string?> { ["Jwt:SigningKey"] = key });

        DevelopmentJwtSigningKey.EnsureConfigured(configuration, SecretsPath);

        Assert.Equal(key, configuration["Jwt:SigningKey"]);
        Assert.False(File.Exists(SecretsPath));
    }

    public void Dispose()
    {
        if (File.Exists(SecretsPath)) File.Delete(SecretsPath);
        if (Directory.Exists(secretsDirectory)) Directory.Delete(secretsDirectory);
    }
}
