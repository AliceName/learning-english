using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Services;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed class BilingualLiveFactAttribute : FactAttribute
{
    public BilingualLiveFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("ENGLISHLEARNING_RUN_LIVE_BILINGUAL_TEST") != "1")
            Skip = "Opt in to the live bilingual dictionary and Vietnamese TTS probes.";
    }
}

public sealed class BilingualLiveTests
{
    private sealed class Factory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new HttpClientHandler { AllowAutoRedirect = false })
            { BaseAddress = new("https://dict.minhqnd.com/"), Timeout = TimeSpan.FromSeconds(25) };
    }

    [BilingualLiveFact]
    public async Task Lookup_both_directions_and_validate_actual_vietnamese_mp3_frames()
    {
        var factory = new Factory();
        var settings = Options.Create(new MinhqndDictionarySettings { TimeoutSeconds = 15 });
        var english = await new MinhqndDictionaryClient(factory, settings, "en-vi").LookupAsync("book", default);
        Assert.Contains(english.Entries.SelectMany(entry => entry.Meanings).SelectMany(meaning => meaning.Definitions), definition => definition.Definition.Contains("Sách", StringComparison.OrdinalIgnoreCase));
        var vietnamese = await new MinhqndDictionaryClient(factory, settings, "vi-en").LookupAsync("học sinh", default);
        Assert.All(vietnamese.Entries.SelectMany(entry => entry.Meanings).SelectMany(meaning => meaning.Definitions), definition => Assert.Equal("en", definition.DefinitionLanguage));
        using var client = factory.CreateClient("DefinitionAudio");
        using var response = await client.GetAsync("api/v1/tts?word=" + Uri.EscapeDataString("người học ở bậc phổ thông") + "&lang=vi");
        response.EnsureSuccessStatusCode();
        Assert.Equal("audio/mpeg", response.Content.Headers.ContentType!.MediaType);
        Assert.InRange(MpegAudioValidation.Validate(await response.Content.ReadAsByteArrayAsync(), 120), .1, 120);
    }
}
