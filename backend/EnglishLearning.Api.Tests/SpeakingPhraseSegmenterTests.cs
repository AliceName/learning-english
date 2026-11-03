using System.Text.RegularExpressions;
using EnglishLearning.Api.Services;

namespace EnglishLearning.Api.Tests;

public sealed class SpeakingPhraseSegmenterTests
{
    [Theory]
    [InlineData("We call it bear.")]
    [InlineData("Don't stop reading now!")]
    [InlineData("  We don’t know.  ")]
    public void Short_sentences_remain_whole(string text)
    {
        var part = Assert.Single(SpeakingPhraseSegmenter.Split(text));
        Assert.Equal(text.Trim(), part.Text);
        Assert.Equal(0, part.Index); Assert.Equal(0, part.StartWordIndex);
        Assert.Equal(Regex.Matches(text, @"[A-Za-z]+(?:['’][A-Za-z]+)*").Count, part.WordCount);
    }

    [Fact]
    public void Example_splits_before_the_prepositional_phrase()
    {
        var parts = SpeakingPhraseSegmenter.Split("There is probably titanium in your eyeglass frames .");
        Assert.Equal(["There is probably titanium", "in your eyeglass frames ."], parts.Select(part => part.Text));
        Assert.Equal([0, 4], parts.Select(part => part.StartWordIndex));
        Assert.Equal([4, 4], parts.Select(part => part.WordCount));
        Assert.Equal("phrase-v1", SpeakingPhraseSegmenter.Version);
    }

    [Fact]
    public void Punctuation_is_preferred_when_a_short_phrase_is_possible()
    {
        var parts = SpeakingPhraseSegmenter.Split("I remember the sound, when we opened the door.");
        Assert.Equal("I remember the sound,", parts[0].Text);
        Assert.Equal("when we opened the door.", parts[1].Text);
    }

    [Theory]
    [InlineData("  Although I don’t know him, I can't forget the story he told us yesterday!  ")]
    [InlineData("She said, \"Don't look back!\" when the children started to run around the room.")]
    [InlineData("The well-known artist will paint a bright picture for the children in our town.")]
    public void Segments_preserve_contractions_words_punctuation_and_contiguous_offsets(string text)
    {
        var parts = SpeakingPhraseSegmenter.Split(text);
        Assert.Equal(Regex.Replace(text, @"\s", ""), Regex.Replace(string.Concat(parts.Select(part => part.Text)), @"\s", ""));
        var originalWords = Regex.Matches(text, @"[A-Za-z]+(?:['’][A-Za-z]+)*").Select(match => match.Value).ToArray();
        var position = 0;
        foreach (var part in parts)
        {
            var words = Regex.Matches(part.Text, @"[A-Za-z]+(?:['’][A-Za-z]+)*").Select(match => match.Value).ToArray();
            Assert.Equal(position, part.StartWordIndex);
            Assert.Equal(originalWords.Skip(position).Take(part.WordCount), words);
            Assert.Equal(part.WordCount, words.Length); position += words.Length;
        }
        Assert.Equal(originalWords.Length, position);
        Assert.Equal(parts, SpeakingPhraseSegmenter.Split(text));
    }

    [Fact]
    public void Long_sentences_have_no_tiny_tail_and_no_more_than_six_words_per_chunk()
    {
        for (var count = 7; count <= 35; count++)
        {
            var parts = SpeakingPhraseSegmenter.Split(string.Join(' ', Enumerable.Repeat("practice", count)));
            Assert.Equal(count, parts.Sum(part => part.WordCount));
            Assert.All(parts, part => Assert.InRange(part.WordCount, 3, 6));
            Assert.Equal(Enumerable.Range(0, parts.Length), parts.Select(part => part.Index));
        }
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData("...!")]
    public void No_words_means_no_practice_chunks(string text) => Assert.Empty(SpeakingPhraseSegmenter.Split(text));
}
