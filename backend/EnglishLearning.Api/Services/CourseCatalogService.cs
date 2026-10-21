using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

public sealed class CourseCatalogService(EnglishLearningDbContext dbContext)
{
    // Uploaded courses belong to their creator, even when published.
    private IQueryable<Course> VisibleCourses(int userId) => dbContext.Courses.AsNoTracking()
        .Where(course => course.IsPublished && (course.SourceType == "system" || course.CreatedBy == userId));

    public async Task<CourseListResponse> ListAsync(int userId, CourseListQuery query, CancellationToken cancellationToken)
    {
        var visible = VisibleCourses(userId);
        var membership = dbContext.UserCourses.AsNoTracking().Where(item => item.UserId == userId);
        var summary = await visible.GroupBy(_ => 1).Select(group => new CourseSummary(
            group.Count(),
            group.Count(course => membership.Any(item => item.CourseId == course.CourseId && item.Status == "in_progress")),
            group.Count(course => membership.Any(item => item.CourseId == course.CourseId && item.Status == "completed"))))
            .SingleOrDefaultAsync(cancellationToken) ?? new CourseSummary(0, 0, 0);

        var courses = visible;
        var search = query.Search?.Trim();
        if (!string.IsNullOrEmpty(search))
            courses = courses.Where(course => course.Title.Contains(search) ||
                (course.Description != null && course.Description.Contains(search)));
        if (query.Source is not null)
            courses = courses.Where(course => course.SourceType == query.Source);
        if (query.Level is not null || query.Skill is not null)
            courses = courses.Where(course => dbContext.Lessons.Any(lesson => lesson.CourseId == course.CourseId &&
                lesson.IsActive && (query.Level == null || lesson.DifficultyLevel == query.Level) &&
                (query.Skill == null || lesson.SkillType == query.Skill)));
        if (query.Status == "not_started")
            courses = courses.Where(course => !membership.Any(item => item.CourseId == course.CourseId));
        else if (query.Status != "all")
            courses = courses.Where(course => membership.Any(item => item.CourseId == course.CourseId && item.Status == query.Status));

        var total = await courses.CountAsync(cancellationToken);
        var ranked = courses.Select(course => new
        {
            Course = course,
            EnrollmentCount = dbContext.UserCourses.Count(item => item.CourseId == course.CourseId && item.Status != "abandoned")
        });
        var sorted = query.Sort switch
        {
            "popular" => ranked.OrderByDescending(item => item.EnrollmentCount).ThenByDescending(item => item.Course.UpdatedAt).ThenByDescending(item => item.Course.CourseId),
            "newest" => ranked.OrderByDescending(item => item.Course.CreatedAt).ThenByDescending(item => item.Course.CourseId),
            "title" => ranked.OrderBy(item => item.Course.Title).ThenBy(item => item.Course.CourseId),
            _ => ranked.OrderByDescending(item => item.Course.UpdatedAt).ThenByDescending(item => item.Course.CourseId)
        };
        var page = await sorted.Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToListAsync(cancellationToken);
        var ids = page.Select(item => item.Course.CourseId).ToArray();
        var lessons = await dbContext.Lessons.AsNoTracking().Where(item => ids.Contains(item.CourseId) && item.IsActive)
            .Select(item => new { item.CourseId, item.DifficultyLevel, item.SkillType, item.EstimatedMinutes })
            .ToListAsync(cancellationToken);
        var enrollments = await membership.Where(item => ids.Contains(item.CourseId)).ToDictionaryAsync(item => item.CourseId, cancellationToken);
        var items = page.Select(item =>
        {
            var courseLessons = lessons.Where(lesson => lesson.CourseId == item.Course.CourseId).ToList();
            enrollments.TryGetValue(item.Course.CourseId, out var enrollment);
            return ToListItem(item.Course, courseLessons.Count, courseLessons.Sum(lesson => lesson.EstimatedMinutes ?? 0),
                courseLessons.Count(lesson => lesson.EstimatedMinutes.HasValue),
                courseLessons.Select(lesson => lesson.DifficultyLevel), courseLessons.Select(lesson => lesson.SkillType),
                item.EnrollmentCount, enrollment);
        }).ToList();
        return new CourseListResponse(items, total, query.Page, query.PageSize,
            (int)Math.Ceiling((double)total / query.PageSize), summary);
    }

    public async Task<CourseDetailResponse?> GetAsync(int userId, int courseId, CancellationToken cancellationToken)
    {
        var course = await VisibleCourses(userId).SingleOrDefaultAsync(item => item.CourseId == courseId, cancellationToken);
        if (course is null) return null;
        var lessons = await dbContext.Lessons.AsNoTracking().Where(item => item.CourseId == courseId && item.IsActive)
            .OrderBy(item => item.OrderIndex).ThenBy(item => item.LessonId)
            .Select(item => new CourseLessonSummary(item.LessonId, item.Title, item.SkillType, item.DifficultyLevel, item.EstimatedMinutes, item.OrderIndex))
            .ToListAsync(cancellationToken);
        var enrollment = await dbContext.UserCourses.AsNoTracking().SingleOrDefaultAsync(item => item.CourseId == courseId && item.UserId == userId, cancellationToken);
        var count = await dbContext.UserCourses.CountAsync(item => item.CourseId == courseId && item.Status != "abandoned", cancellationToken);
        return new CourseDetailResponse(ToListItem(course, lessons.Count, lessons.Sum(item => item.EstimatedMinutes ?? 0),
            lessons.Count(item => item.EstimatedMinutes.HasValue), lessons.Select(item => item.DifficultyLevel),
            lessons.Select(item => item.SkillType), count, enrollment), lessons);
    }

    private static CourseListItem ToListItem(Course course, int count, int minutes, int timedCount,
        IEnumerable<string?> levels, IEnumerable<string> skills, int enrollmentCount, UserCourse? enrollment) => new(
        course.CourseId, course.Title, course.Description, course.SourceType, course.CoverImageUrl, course.UpdatedAt,
        count, minutes, timedCount,
        levels.Where(level => level is not null).Select(level => level!).Distinct().Order().ToArray(),
        skills.Distinct().Order().ToArray(), enrollmentCount,
        enrollment is null ? null : new CourseEnrollment(enrollment.Status, enrollment.ProgressPercent));
}
