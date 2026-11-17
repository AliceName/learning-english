using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services.AiCourses;

namespace EnglishLearning.Api.Services;

public static class CourseVocabularyContent
{
    // Vocabulary is authored lesson content. Do not expose reading questions, answer keys or translations here.
    public static CourseVocabularyDeck? ReadingDeck(Lesson lesson)
    {
        if (lesson.SkillType != "reading" || !lesson.IsActive) return null;
        try
        {
            var document = JsonSerializer.Deserialize<LessonContentDocument>(lesson.Content ?? "null", AiCourseStore.Json);
            if (document is not { Version: 1, Reading.Vocabulary: { } vocabulary }) return null;
            var cards = vocabulary.Where(item => item is not null && !string.IsNullOrWhiteSpace(item.Word)
                && item.Word.Length <= 100 && !string.IsNullOrWhiteSpace(item.Meaning) && item.Meaning.Length <= 500
                && (item.Example?.Length ?? 0) <= 1000)
                .Select(item => new CourseVocabularyCard(item.Word.Trim(), item.Meaning.Trim(),
                    string.IsNullOrWhiteSpace(item.Example) ? null : item.Example.Trim()))
                .DistinctBy(item => (item.FrontText.Normalize().ToUpperInvariant(), item.BackText.Normalize().ToUpperInvariant()))
                .Take(30).ToArray();
            if (cards.Length == 0) return null;
            var version = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(
                new { lesson.LessonId, lesson.Title, Cards = cards }, AiCourseStore.Json))));
            return new(lesson.LessonId, lesson.Title, lesson.DifficultyLevel, version, cards);
        }
        catch (JsonException) { return null; }
    }
}
