using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public sealed record CourseVocabularyCard(string FrontText, string BackText, string? ExampleSentence);
public sealed record CourseVocabularyDeck(int LessonId, string Title, string? DifficultyLevel, string ContentVersion,
    CourseVocabularyCard[] Cards);
public sealed record CourseVocabularyResponse(int CourseId, string CourseTitle, CourseVocabularyDeck[] ReadingDecks);
public sealed class CopyReadingVocabularyRequest
{
    [Required, StringLength(64, MinimumLength = 64)] public string ContentVersion { get; init; } = "";
}
