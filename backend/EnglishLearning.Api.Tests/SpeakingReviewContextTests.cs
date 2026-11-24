using System.Net;
using System.Net.Http.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services;

namespace EnglishLearning.Api.Tests;

public sealed class SpeakingReviewContextTests
{
    [Fact]
    public void Ordinary_free_practice_has_no_context_and_valid_spans_preserve_original_sentence()
    {
        Assert.Null(SpeakingReviewContext.CreateScope("I read.", null, null));
        var context = SpeakingReviewContext.CreateScope("read", "Yesterday I read a book.", 2)!;
        Assert.Equal("Yesterday I read a book.", context.SentenceText);
        Assert.Equal(2, context.StartWordIndex);
        Assert.Equal(1, context.WordCount);
        Assert.Equal("free-review-v1", context.SegmentationVersion);
        context = SpeakingReviewContext.CreateScope("DON'T know", "I don’t know.", 1)!;
        Assert.Equal(2, context.WordCount);
    }

    [Theory]
    [InlineData("read", "Yesterday I read a book.", 1)]
    [InlineData("read", "Yesterday I read a book.", 8)]
    [InlineData("read", "Yesterday I read a book.", -1)]
    [InlineData("read a book", "Yesterday I read a book.", 3)]
    [InlineData("read", "Yesterday I read a book.", null)]
    [InlineData("read", null, 2)]
    [InlineData("read", "Yesterday I read 2 books.", 2)]
    public void Invalid_bounds_mismatched_text_and_missing_context_pairs_are_rejected(string text, string? source, int? start)
    {
        var error = Assert.Throws<SpeakingException>(() => SpeakingReviewContext.CreateScope(text, source, start));
        Assert.Equal(400, error.Status);
    }

    [Fact]
    public async Task Past_read_keeps_source_and_word_offset_when_sent_to_python_client()
    {
        var handler = new CapturingHandler();
        using var client = new HttpClient(handler) { BaseAddress = new Uri("http://localhost/") };
        var scope = SpeakingReviewContext.CreateScope("read", "Yesterday I read a book.", 2);
        await new SpeakingScorerClient(client).ScoreAsync([1], "read", default, scope);
        Assert.Equal("read", handler.Fields["text"]);
        Assert.Equal("Yesterday I read a book.", handler.Fields["sentenceText"]);
        Assert.Equal("2", handler.Fields["startWordIndex"]);
    }

    private sealed class CapturingHandler : HttpMessageHandler
    {
        public Dictionary<string, string> Fields = [];
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            foreach (var field in (MultipartFormDataContent)request.Content!)
                Fields[field.Headers.ContentDisposition!.Name!.Trim('"')] = await field.ReadAsStringAsync(ct);
            return new(HttpStatusCode.OK) { Content = JsonContent.Create(new SpeakingAssessment("scored", "test", 1, 75, 1, 1,
                [new(0, "read", "scored", 1.5, [new("EH", "ɛ", 1.5, .1, .5)], null)], [], "Test only.")) };
        }
    }
}
