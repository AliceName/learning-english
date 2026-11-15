using System.Data;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

public sealed class CourseVocabularyService(EnglishLearningDbContext db, TimeProvider clock)
{
    private async Task<Course> RequireAsync(int user, int courseId, CancellationToken ct)
    {
        var admin = await db.Users.AnyAsync(item => item.UserId == user && item.IsActive && item.Role == "admin", ct);
        return await db.Courses.AsNoTracking().SingleOrDefaultAsync(course => course.CourseId == courseId &&
            (course.IsPublished && (course.SourceType == "system" || course.CreatedBy == user) || admin && course.SourceType == "system"), ct)
            ?? throw new CourseTextLessonException(404, "Không tìm thấy khóa học.");
    }

    public async Task<CourseVocabularyResponse> GetAsync(int user, int courseId, CancellationToken ct)
    {
        var course = await RequireAsync(user, courseId, ct);
        var lessons = await db.Lessons.AsNoTracking().Where(lesson => lesson.CourseId == courseId && lesson.IsActive && lesson.SkillType == "reading")
            .OrderBy(lesson => lesson.OrderIndex).ThenBy(lesson => lesson.LessonId).ToArrayAsync(ct);
        var decks = lessons.Select(CourseVocabularyContent.ReadingDeck).OfType<CourseVocabularyDeck>().ToArray();
        return new(courseId, course.Title, decks);
    }

    public async Task<DeckSummary> CopyReadingAsync(int user, int courseId, int lessonId, CopyReadingVocabularyRequest request, CancellationToken ct)
    {
        await using var transaction = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct) : null;
        var course = await RequireAsync(user, courseId, ct);
        var source = await db.Lessons.AsNoTracking().SingleOrDefaultAsync(item => item.CourseId == courseId && item.LessonId == lessonId && item.IsActive, ct);
        var vocabulary = source is null ? null : CourseVocabularyContent.ReadingDeck(source);
        if (vocabulary is null) throw new CourseTextLessonException(404, "Bài học chưa có từ vựng để tạo bộ thẻ.");
        if (!string.Equals(request.ContentVersion, vocabulary.ContentVersion, StringComparison.Ordinal))
            throw new CourseTextLessonException(409, "Từ vựng đã thay đổi. Hãy tải lại trang trước khi tạo bộ thẻ.");
        if (await db.FlashcardDecks.CountAsync(item => item.UserId == user, ct) >= 100)
            throw new CourseTextLessonException(400, "Mỗi tài khoản tối đa 100 bộ thẻ.");
        var now = clock.GetUtcNow().UtcDateTime;
        var title = "Từ vựng · " + vocabulary.Title;
        var deck = new FlashcardDeck { CourseId = courseId, UserId = user, Title = title[..Math.Min(255, title.Length)],
            Description = "Tổng hợp từ bài Reading trong khóa học.", CreatedAt = now, UpdatedAt = now };
        db.FlashcardDecks.Add(deck); await db.SaveChangesAsync(ct);
        db.Flashcards.AddRange(vocabulary.Cards.Select(card => new Flashcard { DeckId = deck.DeckId,
            FrontText = card.FrontText, BackText = card.BackText, ExampleSentence = card.ExampleSentence, CreatedAt = now, UpdatedAt = now }));
        await db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        var admin = await db.Users.AnyAsync(item => item.UserId == user && item.Role == "admin", ct);
        return new(deck.DeckId, deck.Title, deck.Description, vocabulary.Cards.Length, vocabulary.Cards.Length, true, admin, courseId, course.Title);
    }
}
