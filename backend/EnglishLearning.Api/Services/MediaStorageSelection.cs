using EnglishLearning.Api.Configuration;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Services;

public sealed class MediaStorageSelection(IHostEnvironment environment, IConfiguration configuration,
    IOptions<CloudinarySettings> cloud)
{
    public bool UseDevelopmentLocalStorage { get; } = environment.IsDevelopment()
        && configuration.GetValue<bool>("MediaStorage:EnableDevelopmentLocalStorage") && !cloud.Value.Enabled;

    public IMediaStorage Create(Func<IMediaStorage> local, Func<IMediaStorage> remote) =>
        UseDevelopmentLocalStorage ? local() : remote();
}
