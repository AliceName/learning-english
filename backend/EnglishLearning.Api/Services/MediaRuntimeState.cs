using System.Diagnostics;
using System.Text;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services;

public sealed record MediaRuntimeStatus(string Revision, string Mode, string? TargetHash, string InstanceId, DateTime StartedAtUtc);
public sealed class MediaRuntimeState(IOptions<CloudinarySettings> options, MediaStorageSelection? selection = null)
{
    private readonly string instance = Guid.NewGuid().ToString("N");
    private readonly DateTime started = Process.GetCurrentProcess().StartTime.ToUniversalTime();
    public static string TargetHash(CloudinarySettings settings) => CloudMediaNames.Digest(Encoding.UTF8.GetBytes(settings.EnvironmentPrefix + "\n" + CloudMediaNames.Digest(Encoding.UTF8.GetBytes(settings.CloudName))));
    public MediaRuntimeStatus Status() => new("cloud-cutover-v1", selection?.UseDevelopmentLocalStorage == true ? "local-development" :
        options.Value.Enabled ? options.Value.AllowLegacyReads ? "cloud-with-legacy-read" : "cloud-only" :
        options.Value.AllowLegacyReads ? "legacy-read-only" : "unconfigured",
        selection?.UseDevelopmentLocalStorage != true && options.Value.Enabled ? TargetHash(options.Value) : null, instance, started);
}
