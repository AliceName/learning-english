using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

internal static class ContentVisibility
{
    internal static IQueryable<Course> VisibleCourses(this EnglishLearningDbContext db, int userId) =>
        db.Courses.AsNoTracking()
            .Where(course => course.IsPublished && (course.SourceType == "system" || course.CreatedBy == userId));

    internal static IQueryable<FlashcardDeck> VisibleFlashcardDecks(this EnglishLearningDbContext db, int userId) =>
        db.FlashcardDecks.AsNoTracking().Where(deck => deck.UserId == userId ||
            db.Users.Any(user => user.UserId == deck.UserId && user.IsActive && user.Role == "admin") &&
            (deck.CourseId == null || db.Courses.Any(course => course.CourseId == deck.CourseId && course.IsPublished &&
                (course.SourceType == "system" || course.CreatedBy == userId))));
}
