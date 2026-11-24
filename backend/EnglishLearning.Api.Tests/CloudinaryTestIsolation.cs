using System.Runtime.CompilerServices;
using EnglishLearning.Api.Configuration;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

internal static class CloudinaryTestIsolation
{
    // WebApplicationFactory runs in Development, which loads the developer's user-secrets, including real
    // Cloudinary credentials. Environment variables override user-secrets, so tests never reach the real
    // account; a test that needs cloud media opts in through its own in-memory configuration and a fake store.
    [ModuleInitializer]
    internal static void Initialize()
    {
        Environment.SetEnvironmentVariable("Cloudinary__Enabled", "false");
        Environment.SetEnvironmentVariable("Cloudinary__CloudName", "test-cloud");
        Environment.SetEnvironmentVariable("Cloudinary__ApiKey", "123456789");
        Environment.SetEnvironmentVariable("Cloudinary__ApiSecret", "test-only-secret");
        Environment.SetEnvironmentVariable("Cloudinary__EnvironmentPrefix", "els/test");
    }
}

public sealed class CloudinaryTestIsolationTests
{
    [Fact]
    public void Development_factory_never_sees_real_cloudinary_secrets()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseEnvironment("Development").ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?> {
                    ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only" })));
        var settings = factory.Services.GetRequiredService<IOptions<CloudinarySettings>>().Value;
        Assert.False(settings.Enabled);
        Assert.Equal("test-cloud", settings.CloudName);
        Assert.Equal("els/test", settings.EnvironmentPrefix);
    }
}
