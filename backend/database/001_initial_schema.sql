-- Initial schema approved in DATABASE_SCHEMA.md, sections 2.1–2.13.
-- Run explicitly with sqlcmd; the API never runs this script on startup.
-- Re-running creates missing tables only; it never alters or deletes existing data.
USE [master];
GO
IF DB_ID(N'EnglishLearningDB') IS NULL
    CREATE DATABASE [EnglishLearningDB];
GO
USE [EnglishLearningDB];
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
    BEGIN
        CREATE TABLE [dbo].[Users] (
            [UserId] INT IDENTITY(1,1) NOT NULL,
            [Email] NVARCHAR(255) NOT NULL,
            [PasswordHash] NVARCHAR(255) NOT NULL,
            [FullName] NVARCHAR(150) NOT NULL,
            [AvatarUrl] NVARCHAR(500) NULL,
            [TargetLevel] NVARCHAR(10) NULL,
            [CurrentStreak] INT NOT NULL DEFAULT (0),
            [LongestStreak] INT NOT NULL DEFAULT (0),
            [LastStudyDate] DATE NULL,
            [IsActive] BIT NOT NULL DEFAULT (1),
            [CreatedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            [UpdatedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            CONSTRAINT [PK_Users] PRIMARY KEY ([UserId]),
            CONSTRAINT [AK_Users_Email] UNIQUE ([Email]),
            CONSTRAINT [CK_Users_TargetLevel] CHECK ([TargetLevel] IN (N'A1', N'A2', N'B1', N'B2', N'C1', N'C2'))
        );
    END;

    IF OBJECT_ID(N'dbo.Courses', N'U') IS NULL
    BEGIN
        CREATE TABLE [dbo].[Courses] (
            [CourseId] INT IDENTITY(1,1) NOT NULL,
            [Title] NVARCHAR(255) NOT NULL,
            [Description] NVARCHAR(MAX) NULL,
            [SourceType] NVARCHAR(20) NOT NULL DEFAULT (N'system'),
            [CoverImageUrl] NVARCHAR(500) NULL,
            [CreatedBy] INT NULL,
            [IsPublished] BIT NOT NULL DEFAULT (1),
            [CreatedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            [UpdatedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            CONSTRAINT [PK_Courses] PRIMARY KEY ([CourseId]),
            CONSTRAINT [FK_Courses_Users_CreatedBy] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Users] ([UserId]),
            CONSTRAINT [CK_Courses_SourceType] CHECK ([SourceType] IN (N'system', N'user_upload'))
        );
    END;

    IF OBJECT_ID(N'dbo.UserCourses', N'U') IS NULL
    BEGIN
        CREATE TABLE [dbo].[UserCourses] (
            [UserCourseId] INT IDENTITY(1,1) NOT NULL,
            [UserId] INT NOT NULL,
            [CourseId] INT NOT NULL,
            [EnrolledAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            [Status] NVARCHAR(20) NOT NULL DEFAULT (N'in_progress'),
            [ProgressPercent] DECIMAL(5,2) NOT NULL DEFAULT (0),
            CONSTRAINT [PK_UserCourses] PRIMARY KEY ([UserCourseId]),
            CONSTRAINT [AK_UserCourses_UserId_CourseId] UNIQUE ([UserId], [CourseId]),
            CONSTRAINT [FK_UserCourses_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [dbo].[Users] ([UserId]),
            CONSTRAINT [FK_UserCourses_Courses_CourseId] FOREIGN KEY ([CourseId]) REFERENCES [dbo].[Courses] ([CourseId]),
            CONSTRAINT [CK_UserCourses_Status] CHECK ([Status] IN (N'in_progress', N'completed', N'abandoned')),
            CONSTRAINT [CK_UserCourses_ProgressPercent] CHECK ([ProgressPercent] >= 0 AND [ProgressPercent] <= 100)
        );
    END;

    IF OBJECT_ID(N'dbo.Lessons', N'U') IS NULL
    BEGIN
        CREATE TABLE [dbo].[Lessons] (
            [LessonId] INT IDENTITY(1,1) NOT NULL,
            [CourseId] INT NOT NULL,
            [Title] NVARCHAR(255) NOT NULL,
            [SkillType] NVARCHAR(20) NOT NULL,
            [Content] NVARCHAR(MAX) NULL,
            [AudioUrl] NVARCHAR(500) NULL,
            [OrderIndex] INT NOT NULL DEFAULT (0),
            [DifficultyLevel] NVARCHAR(10) NULL,
            [EstimatedMinutes] INT NULL,
            [IsActive] BIT NOT NULL DEFAULT (1),
            [CreatedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            CONSTRAINT [PK_Lessons] PRIMARY KEY ([LessonId]),
            CONSTRAINT [FK_Lessons_Courses_CourseId] FOREIGN KEY ([CourseId]) REFERENCES [dbo].[Courses] ([CourseId]) ON DELETE CASCADE,
            CONSTRAINT [CK_Lessons_SkillType] CHECK ([SkillType] IN (N'speaking', N'writing', N'listening', N'reading')),
            CONSTRAINT [CK_Lessons_DifficultyLevel] CHECK ([DifficultyLevel] IN (N'A1', N'A2', N'B1', N'B2', N'C1', N'C2'))
        );
    END;

    IF OBJECT_ID(N'dbo.SpeakingAttempts', N'U') IS NULL
    BEGIN
        CREATE TABLE [dbo].[SpeakingAttempts] (
            [AttemptId] INT IDENTITY(1,1) NOT NULL,
            [UserId] INT NOT NULL,
            [LessonId] INT NOT NULL,
            [AudioUrl] NVARCHAR(500) NOT NULL,
            [OverallScore] DECIMAL(5,2) NULL,
            [PhonemeScores] NVARCHAR(MAX) NULL,
            [Feedback] NVARCHAR(MAX) NULL,
            [DurationSeconds] INT NULL,
            [CreatedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            CONSTRAINT [PK_SpeakingAttempts] PRIMARY KEY ([AttemptId]),
            CONSTRAINT [FK_SpeakingAttempts_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [dbo].[Users] ([UserId]),
            CONSTRAINT [FK_SpeakingAttempts_Lessons_LessonId] FOREIGN KEY ([LessonId]) REFERENCES [dbo].[Lessons] ([LessonId]),
            CONSTRAINT [CK_SpeakingAttempts_OverallScore] CHECK ([OverallScore] >= 0 AND [OverallScore] <= 100)
        );
    END;

    IF OBJECT_ID(N'dbo.WritingSubmissions', N'U') IS NULL
    BEGIN
        CREATE TABLE [dbo].[WritingSubmissions] (
            [SubmissionId] INT IDENTITY(1,1) NOT NULL,
            [UserId] INT NOT NULL,
            [LessonId] INT NULL,
            [Topic] NVARCHAR(500) NULL,
            [OriginalText] NVARCHAR(MAX) NOT NULL,
            [CorrectedText] NVARCHAR(MAX) NULL,
            [CefrLevel] NVARCHAR(10) NULL,
            [ErrorsJson] NVARCHAR(MAX) NULL,
            [Feedback] NVARCHAR(MAX) NULL,
            [Score] DECIMAL(5,2) NULL,
            [CreatedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            [UpdatedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            CONSTRAINT [PK_WritingSubmissions] PRIMARY KEY ([SubmissionId]),
            CONSTRAINT [FK_WritingSubmissions_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [dbo].[Users] ([UserId]),
            CONSTRAINT [FK_WritingSubmissions_Lessons_LessonId] FOREIGN KEY ([LessonId]) REFERENCES [dbo].[Lessons] ([LessonId]),
            CONSTRAINT [CK_WritingSubmissions_CefrLevel] CHECK ([CefrLevel] IN (N'A1', N'A2', N'B1', N'B2', N'C1', N'C2'))
        );
    END;

    IF OBJECT_ID(N'dbo.ExerciseResults', N'U') IS NULL
    BEGIN
        CREATE TABLE [dbo].[ExerciseResults] (
            [ResultId] INT IDENTITY(1,1) NOT NULL,
            [UserId] INT NOT NULL,
            [LessonId] INT NOT NULL,
            [Score] DECIMAL(5,2) NOT NULL,
            [TotalQuestions] INT NOT NULL,
            [CorrectAnswers] INT NOT NULL,
            [WrongAnswersJson] NVARCHAR(MAX) NULL,
            [TimeSpentSeconds] INT NULL,
            [SubmittedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            CONSTRAINT [PK_ExerciseResults] PRIMARY KEY ([ResultId]),
            CONSTRAINT [FK_ExerciseResults_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [dbo].[Users] ([UserId]),
            CONSTRAINT [FK_ExerciseResults_Lessons_LessonId] FOREIGN KEY ([LessonId]) REFERENCES [dbo].[Lessons] ([LessonId]),
            CONSTRAINT [CK_ExerciseResults_Score] CHECK ([Score] >= 0 AND [Score] <= 100)
        );
    END;

    IF OBJECT_ID(N'dbo.ErrorLogs', N'U') IS NULL
    BEGIN
        CREATE TABLE [dbo].[ErrorLogs] (
            [ErrorLogId] INT IDENTITY(1,1) NOT NULL,
            [UserId] INT NOT NULL,
            [SkillType] NVARCHAR(20) NOT NULL,
            [LessonId] INT NULL,
            [QuestionRef] NVARCHAR(255) NULL,
            [UserAnswer] NVARCHAR(MAX) NULL,
            [CorrectAnswer] NVARCHAR(MAX) NULL,
            [Explanation] NVARCHAR(MAX) NULL,
            [Status] NVARCHAR(20) NOT NULL DEFAULT (N'unresolved'),
            [CreatedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            [ResolvedAt] DATETIME2 NULL,
            CONSTRAINT [PK_ErrorLogs] PRIMARY KEY ([ErrorLogId]),
            CONSTRAINT [FK_ErrorLogs_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [dbo].[Users] ([UserId]),
            CONSTRAINT [FK_ErrorLogs_Lessons_LessonId] FOREIGN KEY ([LessonId]) REFERENCES [dbo].[Lessons] ([LessonId]),
            CONSTRAINT [CK_ErrorLogs_SkillType] CHECK ([SkillType] IN (N'speaking', N'writing', N'listening', N'reading')),
            CONSTRAINT [CK_ErrorLogs_Status] CHECK ([Status] IN (N'unresolved', N'resolved'))
        );
    END;

    IF OBJECT_ID(N'dbo.FlashcardDecks', N'U') IS NULL
    BEGIN
        CREATE TABLE [dbo].[FlashcardDecks] (
            [DeckId] INT IDENTITY(1,1) NOT NULL,
            [UserId] INT NOT NULL,
            [Title] NVARCHAR(255) NOT NULL,
            [Description] NVARCHAR(500) NULL,
            [CreatedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            [UpdatedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            CONSTRAINT [PK_FlashcardDecks] PRIMARY KEY ([DeckId]),
            CONSTRAINT [FK_FlashcardDecks_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [dbo].[Users] ([UserId])
        );
    END;

    IF OBJECT_ID(N'dbo.Flashcards', N'U') IS NULL
    BEGIN
        CREATE TABLE [dbo].[Flashcards] (
            [CardId] INT IDENTITY(1,1) NOT NULL,
            [DeckId] INT NOT NULL,
            [FrontText] NVARCHAR(500) NOT NULL,
            [BackText] NVARCHAR(1000) NOT NULL,
            [ExampleSentence] NVARCHAR(1000) NULL,
            [AudioUrl] NVARCHAR(500) NULL,
            [ImageUrl] NVARCHAR(500) NULL,
            [EaseFactor] DECIMAL(4,2) NOT NULL DEFAULT (2.50),
            [IntervalDays] INT NOT NULL DEFAULT (0),
            [Repetition] INT NOT NULL DEFAULT (0),
            [NextReviewAt] DATETIME2 NULL,
            [CreatedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            [UpdatedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            CONSTRAINT [PK_Flashcards] PRIMARY KEY ([CardId]),
            CONSTRAINT [FK_Flashcards_FlashcardDecks_DeckId] FOREIGN KEY ([DeckId]) REFERENCES [dbo].[FlashcardDecks] ([DeckId]) ON DELETE CASCADE
        );
    END;

    IF OBJECT_ID(N'dbo.Bookmarks', N'U') IS NULL
    BEGIN
        CREATE TABLE [dbo].[Bookmarks] (
            [BookmarkId] INT IDENTITY(1,1) NOT NULL,
            [UserId] INT NOT NULL,
            [TargetType] NVARCHAR(30) NOT NULL,
            [TargetId] INT NOT NULL,
            [Note] NVARCHAR(500) NULL,
            [CreatedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            CONSTRAINT [PK_Bookmarks] PRIMARY KEY ([BookmarkId]),
            CONSTRAINT [AK_Bookmarks_UserId_TargetType_TargetId] UNIQUE ([UserId], [TargetType], [TargetId]),
            CONSTRAINT [FK_Bookmarks_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [dbo].[Users] ([UserId]),
            CONSTRAINT [CK_Bookmarks_TargetType] CHECK ([TargetType] IN (N'lesson', N'writing', N'flashcard', N'course', N'vocabulary'))
        );
    END;

    IF OBJECT_ID(N'dbo.LearningProgress', N'U') IS NULL
    BEGIN
        CREATE TABLE [dbo].[LearningProgress] (
            [ProgressId] INT IDENTITY(1,1) NOT NULL,
            [UserId] INT NOT NULL,
            [CourseId] INT NOT NULL,
            [LastLessonId] INT NULL,
            [LastPosition] NVARCHAR(100) NULL,
            [UpdatedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            CONSTRAINT [PK_LearningProgress] PRIMARY KEY ([ProgressId]),
            CONSTRAINT [AK_LearningProgress_UserId_CourseId] UNIQUE ([UserId], [CourseId]),
            CONSTRAINT [FK_LearningProgress_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [dbo].[Users] ([UserId]),
            CONSTRAINT [FK_LearningProgress_Courses_CourseId] FOREIGN KEY ([CourseId]) REFERENCES [dbo].[Courses] ([CourseId]),
            CONSTRAINT [FK_LearningProgress_Lessons_LastLessonId] FOREIGN KEY ([LastLessonId]) REFERENCES [dbo].[Lessons] ([LessonId])
        );
    END;

    IF OBJECT_ID(N'dbo.UploadedDocuments', N'U') IS NULL
    BEGIN
        CREATE TABLE [dbo].[UploadedDocuments] (
            [DocumentId] INT IDENTITY(1,1) NOT NULL,
            [UserId] INT NOT NULL,
            [OriginalFileName] NVARCHAR(255) NOT NULL,
            [FileUrl] NVARCHAR(500) NOT NULL,
            [FileType] NVARCHAR(20) NOT NULL,
            [ExtractedText] NVARCHAR(MAX) NULL,
            [Summary] NVARCHAR(MAX) NULL,
            [GeneratedCourseId] INT NULL,
            [Status] NVARCHAR(20) NOT NULL DEFAULT (N'processing'),
            [CreatedAt] DATETIME2 NOT NULL DEFAULT (SYSDATETIME()),
            [ProcessedAt] DATETIME2 NULL,
            CONSTRAINT [PK_UploadedDocuments] PRIMARY KEY ([DocumentId]),
            CONSTRAINT [FK_UploadedDocuments_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [dbo].[Users] ([UserId]),
            CONSTRAINT [FK_UploadedDocuments_Courses_GeneratedCourseId] FOREIGN KEY ([GeneratedCourseId]) REFERENCES [dbo].[Courses] ([CourseId]),
            CONSTRAINT [CK_UploadedDocuments_FileType] CHECK ([FileType] IN (N'pdf', N'png', N'jpg', N'jpeg', N'docx')),
            CONSTRAINT [CK_UploadedDocuments_Status] CHECK ([Status] IN (N'processing', N'completed', N'failed'))
        );
    END;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
