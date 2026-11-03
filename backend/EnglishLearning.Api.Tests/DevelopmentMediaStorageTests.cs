using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Controllers;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed class DevelopmentMediaStorageTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "englishlearning-audio-tests-" + Guid.NewGuid().ToString("N"));
    public void Dispose() => AudioFixture.RemoveTestRoot(root);

    private IConfiguration Configuration(bool enableLocal) => new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?> { ["MediaStorage:EnableDevelopmentLocalStorage"] = enableLocal.ToString(), ["MediaStorage:RootPath"] = root }).Build();

    private static IFormFile Upload(byte[] bytes, string name, string mime) => new FormFile(new MemoryStream(bytes, false), 0, bytes.Length, "file", name)
        { Headers = new HeaderDictionary(), ContentType = mime };

    [Theory]
    [InlineData("cover", "cover.png", "image/png")]
    [InlineData("audio", "lesson.wav", "audio/wav")]
    public async Task Explicit_development_local_media_saves_and_reads_without_resolving_cloud(string kind, string name, string mime)
    {
        var config = Configuration(true); var environment = new AudioTestEnvironment(); var cloud = Options.Create(new CloudinarySettings());
        var selection = new MediaStorageSelection(environment, config, cloud);
        var storage = selection.Create(() => new MediaStorage(config, environment), () => throw new InvalidOperationException("Cloud must not be resolved"));
        var bytes = kind == "cover" ? CloudinaryEnvironmentSmoke.Fixtures().Single(file => file.ResourceType == "image").Bytes : AudioFixture.Wave();
        var saved = await storage.SaveAsync(Upload(bytes, name, mime), kind, default);
        Assert.True(await storage.ExistsAsync("/api/media/" + saved.FileName, kind == "cover" ? "image/" : "audio/", default));
        await using var read = await storage.OpenAsync(saved.FileName, null, default);
        Assert.NotNull(read); Assert.True(read.EnableRangeProcessing);
        using var body = new MemoryStream(); await read.Body.CopyToAsync(body); Assert.Equal(bytes, body.ToArray());
        var status = new MediaRuntimeState(cloud, selection).Status();
        Assert.Equal("local-development", status.Mode); Assert.Null(status.TargetHash);
    }

    [Theory]
    [InlineData("Development", false)]
    [InlineData("Production", true)]
    [InlineData("Staging", true)]
    public async Task Missing_opt_in_or_non_development_never_enables_local_writes(string environmentName, bool enableLocal)
    {
        var config = Configuration(enableLocal); var environment = new AudioTestEnvironment { EnvironmentName = environmentName };
        var cloud = Options.Create(new CloudinarySettings()); var selection = new MediaStorageSelection(environment, config, cloud);
        var storage = selection.Create(() => throw new InvalidOperationException("Local storage must not be resolved"),
            () => new CloudinaryCourseMediaStorage(() => throw new InvalidOperationException("Cloud is disabled"),
                () => throw new InvalidOperationException("Cloud is disabled"), () => throw new InvalidOperationException("Legacy storage must not be resolved"), cloud));
        var error = await Assert.ThrowsAsync<AuthoringException>(() => storage.SaveAsync(Upload(AudioFixture.Wave(), "sample.wav", "audio/wav"), "audio", default));
        Assert.Equal(503, error.Status); Assert.False(Directory.Exists(root));
        Assert.Equal("unconfigured", new MediaRuntimeState(cloud, selection).Status().Mode);
    }

    [Fact]
    public async Task Enabled_cloud_wins_over_development_local_and_cloud_failure_never_falls_back()
    {
        var config = Configuration(true); var cloud = Options.Create(new CloudinarySettings { Enabled = true, CloudName = "unit-cloud", EnvironmentPrefix = "els/test" });
        var selection = new MediaStorageSelection(new AudioTestEnvironment(), config, cloud); var remote = new MemoryCloudTransport();
        using var store = new CloudinaryMediaStore(remote, cloud, Options.Create(new CloudinaryMediaOptions()), TimeProvider.System);
        var storage = selection.Create(() => throw new InvalidOperationException("Local storage must not be resolved"),
            () => new CloudinaryCourseMediaStorage(() => store, () => remote, () => throw new InvalidOperationException("Legacy must not be resolved"), cloud));
        var saved = await storage.SaveAsync(Upload(AudioFixture.Wave(), "sample.wav", "audio/wav"), "audio", default);
        await using (var read = await storage.OpenAsync(saved.FileName, null, default)) { Assert.NotNull(read); Assert.False(read.EnableRangeProcessing); }
        remote.FailManifest = true;
        await Assert.ThrowsAsync<CloudMediaException>(() => storage.SaveAsync(Upload(AudioFixture.Wave(), "retry.wav", "audio/wav"), "audio", default));
        Assert.False(Directory.Exists(root));
        var status = new MediaRuntimeState(cloud, selection).Status(); Assert.Equal("cloud-only", status.Mode); Assert.NotNull(status.TargetHash);
    }

    [Fact]
    public async Task Disabled_storage_read_returns_503_problem_instead_of_unhandled_exception()
    {
        await using var db = new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var admin = new User { Email = "media-admin@example.com", FullName = "Media admin", PasswordHash = "test-only", Role = UserRoles.Admin };
        db.Users.Add(admin); await db.SaveChangesAsync();
        var cloud = Options.Create(new CloudinarySettings());
        var storage = new CloudinaryCourseMediaStorage(() => throw new InvalidOperationException("Cloud is disabled"),
            () => throw new InvalidOperationException("Cloud is disabled"), () => throw new InvalidOperationException("Legacy must not be resolved"), cloud);
        var controller = new MediaController(storage, db, NullLogger<MediaController>.Instance) { ControllerContext = new ControllerContext
            { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(JwtRegisteredClaimNames.Sub, admin.UserId.ToString())], "test")) } } };
        var result = Assert.IsType<ObjectResult>(await controller.Get(new string('a', 32) + ".png", default));
        Assert.Equal(503, result.StatusCode); Assert.Equal(503, Assert.IsType<ProblemDetails>(result.Value).Status);
        Assert.Equal("private, no-store", controller.Response.Headers.CacheControl.ToString());
    }
}
