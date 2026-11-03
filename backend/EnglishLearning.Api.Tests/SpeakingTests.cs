using System.Net;
using System.Net.Http.Json;
using System.Text;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Http;

namespace EnglishLearning.Api.Tests;

public sealed class SpeakingContractTests
{
    private static SpeakingAssessment Result() => new("scored", "test-model", 1, 75, 1, 2,
        [new(0, "We", "scored", 1.5, [new("W", "w", 1, .1, .2), new("IY0", "iː", 2, .3, .4)], null)], [], "Nghe lại bản ghi.");

    [Fact]
    public void Rejects_inconsistent_scores_missing_words_and_invalid_timing()
    {
        var valid = Result();
        Assert.True(SpeakingScorerClient.IsValid(valid, "We."));
        Assert.False(SpeakingScorerClient.IsValid(valid with { OverallScore = 99 }, "We"));
        Assert.False(SpeakingScorerClient.IsValid(valid with { Coverage = .5 }, "We"));
        Assert.False(SpeakingScorerClient.IsValid(valid, "We call"));
        Assert.False(SpeakingScorerClient.IsValid(valid with { Words = [valid.Words[0] with { Phones = [new("W", "w", double.NaN, 0, 1)] }] }, "We"));
        Assert.False(SpeakingScorerClient.IsValid(valid with { Words = [valid.Words[0] with { Phones = [new("W", "w", 1, 0, 9)] }] }, "We"));
    }

    [Theory]
    [InlineData("../secret.wav")]
    [InlineData("x.wav")]
    [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.wav/other")]
    public void Recording_paths_are_restricted_to_generated_names(string name) => Assert.False(SpeakingStorage.IsFileName(name));

    [Fact]
    public void Interpretation_preserves_legacy_scores_and_rejects_inconsistent_feedback_or_raw_values()
    {
        var original = Result();
        Assert.True(SpeakingScorerClient.IsValid(original, "We"));
        var info = new SpeakingInterpretation("cal1-test", "identity", 1.1, 1.5, true, .8, "normal", "speechocean762-supported-subset");
        var value = original with { Interpretation = info };
        Assert.True(SpeakingScorerClient.IsValid(value, "We"));
        Assert.False(SpeakingScorerClient.IsValid(value with { Interpretation = info with { PracticeThreshold = double.NaN } }, "We"));
        Assert.False(SpeakingScorerClient.IsValid(value with { Interpretation = info with { ReviewThreshold = .9 } }, "We"));
        Assert.False(SpeakingScorerClient.IsValid(value with { Interpretation = info with { FeedbackMode = "limited_coverage" } }, "We"));
        Assert.False(SpeakingScorerClient.IsValid(value with { Interpretation = info with { EvidenceScope = "all-vietnamese-learners" } }, "We"));
        Assert.True(SpeakingScorerClient.IsValid(value with { Interpretation = info with { FeedbackMode = "record_again" } }, "We"));
        var rawInvalid = value with { Words = [value.Words[0] with { Phones = [new("W", "w", 1, .1, .2, double.PositiveInfinity), new("IY0", "iː", 2, .3, .4, 2)] }] };
        Assert.False(SpeakingScorerClient.IsValid(rawInvalid, "We"));
    }

    [Fact]
    public void Legacy_or_invalid_lesson_content_is_not_exposed_as_practice()
    {
        Assert.Null(SpeakingLessonService.ReadContent("not-json"));
        Assert.Null(SpeakingLessonService.ReadContent("{\"version\":1,\"speaking\":{\"sentences\":[null]}}"));
        Assert.Null(SpeakingLessonService.ReadContent("{\"version\":2,\"speaking\":{\"sentences\":[{\"text\":\"We\"}]}}"));
        Assert.NotNull(SpeakingLessonService.ReadContent("{\"version\":1,\"speaking\":{\"goals\":\"Practice\",\"sentences\":[{\"text\":\"We\"}]}}"));
    }

    [Fact]
    public async Task Wrong_file_content_is_rejected_even_with_wav_extension()
    {
        using var stream = new MemoryStream(new byte[100]);
        var file = new FormFile(stream, 0, stream.Length, "file", "recording.wav");
        await Assert.ThrowsAsync<SpeakingException>(() => SpeakingStorage.ReadWavAsync(file, default));
    }

    [Fact]
    public async Task Client_uses_server_reference_and_maps_rejection_without_fake_score()
    {
        var handler = new Handler();
        using var client = new HttpClient(handler) { BaseAddress = new Uri("http://localhost/") };
        var scorer = new SpeakingScorerClient(client);
        await scorer.ScoreAsync([1, 2, 3], "We", default);
        Assert.Contains("We", handler.Body);
        handler.Reject = true;
        var error = await Assert.ThrowsAsync<SpeakingException>(() => scorer.ScoreAsync([1], "We", default));
        Assert.Equal(400, error.Status);
    }
    private sealed class Handler : HttpMessageHandler
    {
        public bool Reject; public string Body = "";
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Body = await request.Content!.ReadAsStringAsync(ct);
            return Reject ? new(HttpStatusCode.UnprocessableEntity) { Content = new StringContent("{\"title\":\"Ghi lại\"}", Encoding.UTF8, "application/json") }
                : new(HttpStatusCode.OK) { Content = JsonContent.Create(Result()) };
        }
    }
}
