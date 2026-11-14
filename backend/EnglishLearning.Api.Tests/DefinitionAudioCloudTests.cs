using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed class DefinitionAudioCloudTests
{
    private static CloudinaryMediaStore Store(MemoryCloudTransport transport) => new(transport,
        Options.Create(new CloudinarySettings { EnvironmentPrefix = "els/test" }), Options.Create(new CloudinaryMediaOptions()), TimeProvider.System);

    [Fact]
    public async Task Tts_attribution_round_trips_with_cold_read_range_and_multi_instance_commit()
    {
        var transport = new MemoryCloudTransport();
        using var first = Store(transport); using var second = Store(transport);
        var bytes = BilingualFixture.Mp3();
        var key = DefinitionAudioText.Key("Sách.", "v1");
        var credit = new AudioAttribution("minhqnd-tts", "https://dict.minhqnd.com/", "https://dict.minhqnd.com/api/v1/tts?word=S%C3%A1ch.&lang=vi", "@minhqnd", null, null, "vi", true, "v1");
        var saved = await Task.WhenAll(first.StoreAsync(CloudMediaKind.DictionaryAudio, key, bytes, "mp3", credit, default),
            second.StoreAsync(CloudMediaKind.DictionaryAudio, key, bytes, "mp3", credit, default));
        Assert.Equal(saved[0], saved[1]); Assert.Equal(1, transport.ManifestCreates);
        using var restarted = Store(transport);
        var cached = await restarted.FindAsync(CloudMediaKind.DictionaryAudio, key, default);
        Assert.Equal(credit, cached!.Attribution);
        await using var read = await restarted.OpenAsync(CloudMediaKind.DictionaryAudio, key, "bytes=0-99", default);
        Assert.Equal(206, read.Status); Assert.Equal(100, read.Length);
        await Assert.ThrowsAsync<CloudMediaException>(() => restarted.StoreAsync(CloudMediaKind.DictionaryAudio, new string('a', 64), bytes, "mp3",
            credit with { FileUrl = "https://evil.test/tts" }, default));
    }
}
