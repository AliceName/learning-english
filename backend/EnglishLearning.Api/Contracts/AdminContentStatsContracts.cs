namespace EnglishLearning.Api.Contracts;

public sealed record AdminCategoryCount(string Category, int Count);

/// <summary>
/// One Writing library task. Rates use first versions only (a revision is the same round improved).
/// Learner text is read on the server to count words; it is never returned.
/// </summary>
public sealed record AdminWritingTaskStats(
    string TaskId, string Title, string Genre, string Level, string Topic, bool InCatalogue,
    int Learners, int Rounds, int RevisedRounds, int WordsChecked, int Errors, decimal? ErrorsPer100Words,
    int RelevanceChecked, int OffTopic, DateTime? LastWrittenAt, IReadOnlyList<AdminCategoryCount> TopCategories);

public sealed record AdminWritingTaskReport(
    int CountedLearners, int ExcludedAccounts, int SubmissionsRead, bool CatalogueLoaded,
    IReadOnlyList<AdminWritingTaskStats> Tasks, IReadOnlyList<AdminCategoryCount> Categories);

public sealed record AdminMissedQuestion(int QuestionId, string? Prompt, int Misses, int Attempts);

/// <summary>Counts per lesson for real learners. Most-missed questions use only attempts on the lesson's current content.</summary>
public sealed record AdminLessonStats(
    int LessonId, string Title, string SkillType, int OrderIndex, bool IsActive,
    int Learners, int Attempts, decimal? AverageScore, int? AverageSeconds, decimal? PassRate, int NotStarted,
    int CurrentVersionAttempts, IReadOnlyList<AdminMissedQuestion> MostMissed);

public sealed record AdminCourseStats(int CourseId, string Title, bool IsPublished, int Enrolled, IReadOnlyList<AdminLessonStats> Lessons);
