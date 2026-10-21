using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Authentication;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Data;

// Exact mappings from DATABASE_SCHEMA.md, sections 2.1–2.13.
internal static class EnglishLearningModel
{
    internal static void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("Users", "dbo", table =>
            {
                table.HasCheckConstraint("CK_Users_TargetLevel", "[TargetLevel] IN (N'A1', N'A2', N'B1', N'B2', N'C1', N'C2')");
                table.HasCheckConstraint("CK_Users_Role", "[Role] COLLATE Latin1_General_100_BIN2 IN (N'admin', N'user')");
            });
            entity.HasKey(item => item.UserId);
            entity.Property(item => item.UserId).HasColumnType("int").IsRequired(true).UseIdentityColumn(1, 1);
            entity.Property(item => item.Email).HasColumnType("nvarchar(255)").HasMaxLength(255).IsRequired(true);
            entity.Property(item => item.PasswordHash).HasColumnType("nvarchar(255)").HasMaxLength(255).IsRequired(true);
            entity.Property(item => item.FullName).HasColumnType("nvarchar(150)").HasMaxLength(150).IsRequired(true);
            entity.Property(item => item.Role).HasColumnType("nvarchar(20)").HasMaxLength(20).IsRequired(true).HasDefaultValue(UserRoles.User);
            entity.Property(item => item.AvatarUrl).HasColumnType("nvarchar(500)").HasMaxLength(500).IsRequired(false);
            entity.Property(item => item.TargetLevel).HasColumnType("nvarchar(10)").HasMaxLength(10).IsRequired(false);
            entity.Property(item => item.CurrentStreak).HasColumnType("int").IsRequired(true).HasDefaultValue(0);
            entity.Property(item => item.LongestStreak).HasColumnType("int").IsRequired(true).HasDefaultValue(0);
            entity.Property(item => item.LastStudyDate).HasColumnType("date").IsRequired(false);
            entity.Property(item => item.IsActive).HasColumnType("bit").IsRequired(true).HasDefaultValue(true);
            entity.Property(item => item.CreatedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.Property(item => item.UpdatedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.HasAlternateKey(item => item.Email);
        });

        modelBuilder.Entity<Course>(entity =>
        {
            entity.ToTable("Courses", "dbo", table =>
            {
                table.HasCheckConstraint("CK_Courses_SourceType", "[SourceType] IN (N'system', N'user_upload')");
            });
            entity.HasKey(item => item.CourseId);
            entity.Property(item => item.CourseId).HasColumnType("int").IsRequired(true).UseIdentityColumn(1, 1);
            entity.Property(item => item.Title).HasColumnType("nvarchar(255)").HasMaxLength(255).IsRequired(true);
            entity.Property(item => item.Description).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(item => item.SourceType).HasColumnType("nvarchar(20)").HasMaxLength(20).IsRequired(true).HasDefaultValue("system");
            entity.Property(item => item.CoverImageUrl).HasColumnType("nvarchar(500)").HasMaxLength(500).IsRequired(false);
            entity.Property(item => item.CreatedBy).HasColumnType("int").IsRequired(false);
            entity.Property(item => item.IsPublished).HasColumnType("bit").IsRequired(true).HasDefaultValue(true);
            entity.Property(item => item.CreatedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.Property(item => item.UpdatedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.HasOne<User>().WithMany().HasForeignKey(item => item.CreatedBy).OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<UserCourse>(entity =>
        {
            entity.ToTable("UserCourses", "dbo", table =>
            {
                table.HasCheckConstraint("CK_UserCourses_Status", "[Status] IN (N'in_progress', N'completed', N'abandoned')");
                table.HasCheckConstraint("CK_UserCourses_ProgressPercent", "[ProgressPercent] >= 0 AND [ProgressPercent] <= 100");
            });
            entity.HasKey(item => item.UserCourseId);
            entity.Property(item => item.UserCourseId).HasColumnType("int").IsRequired(true).UseIdentityColumn(1, 1);
            entity.Property(item => item.UserId).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.CourseId).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.EnrolledAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.Property(item => item.Status).HasColumnType("nvarchar(20)").HasMaxLength(20).IsRequired(true).HasDefaultValue("in_progress");
            entity.Property(item => item.ProgressPercent).HasColumnType("decimal(5,2)").HasPrecision(5, 2).IsRequired(true).HasDefaultValue(0m);
            entity.HasAlternateKey(item => new { item.UserId, item.CourseId });
            entity.HasOne<User>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.NoAction);
            entity.HasOne<Course>().WithMany().HasForeignKey(item => item.CourseId).OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<Lesson>(entity =>
        {
            entity.ToTable("Lessons", "dbo", table =>
            {
                table.HasCheckConstraint("CK_Lessons_SkillType", "[SkillType] IN (N'speaking', N'writing', N'listening', N'reading')");
                table.HasCheckConstraint("CK_Lessons_DifficultyLevel", "[DifficultyLevel] IN (N'A1', N'A2', N'B1', N'B2', N'C1', N'C2')");
            });
            entity.HasKey(item => item.LessonId);
            entity.Property(item => item.LessonId).HasColumnType("int").IsRequired(true).UseIdentityColumn(1, 1);
            entity.Property(item => item.CourseId).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.Title).HasColumnType("nvarchar(255)").HasMaxLength(255).IsRequired(true);
            entity.Property(item => item.SkillType).HasColumnType("nvarchar(20)").HasMaxLength(20).IsRequired(true);
            entity.Property(item => item.Content).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(item => item.AudioUrl).HasColumnType("nvarchar(500)").HasMaxLength(500).IsRequired(false);
            entity.Property(item => item.OrderIndex).HasColumnType("int").IsRequired(true).HasDefaultValue(0);
            entity.Property(item => item.DifficultyLevel).HasColumnType("nvarchar(10)").HasMaxLength(10).IsRequired(false);
            entity.Property(item => item.EstimatedMinutes).HasColumnType("int").IsRequired(false);
            entity.Property(item => item.IsActive).HasColumnType("bit").IsRequired(true).HasDefaultValue(true);
            entity.Property(item => item.CreatedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.HasOne<Course>().WithMany().HasForeignKey(item => item.CourseId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<SpeakingAttempt>(entity =>
        {
            entity.ToTable("SpeakingAttempts", "dbo", table =>
            {
                table.HasCheckConstraint("CK_SpeakingAttempts_OverallScore", "[OverallScore] >= 0 AND [OverallScore] <= 100");
            });
            entity.HasKey(item => item.AttemptId);
            entity.Property(item => item.AttemptId).HasColumnType("int").IsRequired(true).UseIdentityColumn(1, 1);
            entity.Property(item => item.UserId).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.LessonId).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.AudioUrl).HasColumnType("nvarchar(500)").HasMaxLength(500).IsRequired(true);
            entity.Property(item => item.OverallScore).HasColumnType("decimal(5,2)").HasPrecision(5, 2).IsRequired(false);
            entity.Property(item => item.PhonemeScores).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(item => item.Feedback).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(item => item.DurationSeconds).HasColumnType("int").IsRequired(false);
            entity.Property(item => item.CreatedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.HasOne<User>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.NoAction);
            entity.HasOne<Lesson>().WithMany().HasForeignKey(item => item.LessonId).OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<WritingSubmission>(entity =>
        {
            entity.ToTable("WritingSubmissions", "dbo", table =>
            {
                table.HasCheckConstraint("CK_WritingSubmissions_CefrLevel", "[CefrLevel] IN (N'A1', N'A2', N'B1', N'B2', N'C1', N'C2')");
            });
            entity.HasKey(item => item.SubmissionId);
            entity.Property(item => item.SubmissionId).HasColumnType("int").IsRequired(true).UseIdentityColumn(1, 1);
            entity.Property(item => item.UserId).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.LessonId).HasColumnType("int").IsRequired(false);
            entity.Property(item => item.Topic).HasColumnType("nvarchar(500)").HasMaxLength(500).IsRequired(false);
            entity.Property(item => item.OriginalText).HasColumnType("nvarchar(max)").IsRequired(true);
            entity.Property(item => item.CorrectedText).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(item => item.CefrLevel).HasColumnType("nvarchar(10)").HasMaxLength(10).IsRequired(false);
            entity.Property(item => item.ErrorsJson).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(item => item.Feedback).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(item => item.Score).HasColumnType("decimal(5,2)").HasPrecision(5, 2).IsRequired(false);
            entity.Property(item => item.CreatedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.Property(item => item.UpdatedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.HasOne<User>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.NoAction);
            entity.HasOne<Lesson>().WithMany().HasForeignKey(item => item.LessonId).OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<ExerciseResult>(entity =>
        {
            entity.ToTable("ExerciseResults", "dbo", table =>
            {
                table.HasCheckConstraint("CK_ExerciseResults_Score", "[Score] >= 0 AND [Score] <= 100");
            });
            entity.HasKey(item => item.ResultId);
            entity.Property(item => item.ResultId).HasColumnType("int").IsRequired(true).UseIdentityColumn(1, 1);
            entity.Property(item => item.UserId).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.LessonId).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.Score).HasColumnType("decimal(5,2)").HasPrecision(5, 2).IsRequired(true);
            entity.Property(item => item.TotalQuestions).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.CorrectAnswers).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.WrongAnswersJson).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(item => item.TimeSpentSeconds).HasColumnType("int").IsRequired(false);
            entity.Property(item => item.SubmittedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.HasOne<User>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.NoAction);
            entity.HasOne<Lesson>().WithMany().HasForeignKey(item => item.LessonId).OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<ErrorLog>(entity =>
        {
            entity.ToTable("ErrorLogs", "dbo", table =>
            {
                table.HasCheckConstraint("CK_ErrorLogs_SkillType", "[SkillType] IN (N'speaking', N'writing', N'listening', N'reading')");
                table.HasCheckConstraint("CK_ErrorLogs_Status", "[Status] IN (N'unresolved', N'resolved')");
            });
            entity.HasKey(item => item.ErrorLogId);
            entity.Property(item => item.ErrorLogId).HasColumnType("int").IsRequired(true).UseIdentityColumn(1, 1);
            entity.Property(item => item.UserId).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.SkillType).HasColumnType("nvarchar(20)").HasMaxLength(20).IsRequired(true);
            entity.Property(item => item.LessonId).HasColumnType("int").IsRequired(false);
            entity.Property(item => item.QuestionRef).HasColumnType("nvarchar(255)").HasMaxLength(255).IsRequired(false);
            entity.Property(item => item.UserAnswer).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(item => item.CorrectAnswer).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(item => item.Explanation).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(item => item.Status).HasColumnType("nvarchar(20)").HasMaxLength(20).IsRequired(true).HasDefaultValue("unresolved");
            entity.Property(item => item.CreatedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.Property(item => item.ResolvedAt).HasColumnType("datetime2").IsRequired(false);
            entity.HasOne<User>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.NoAction);
            entity.HasOne<Lesson>().WithMany().HasForeignKey(item => item.LessonId).OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<FlashcardDeck>(entity =>
        {
            entity.ToTable("FlashcardDecks", "dbo");
            entity.HasKey(item => item.DeckId);
            entity.Property(item => item.DeckId).HasColumnType("int").IsRequired(true).UseIdentityColumn(1, 1);
            entity.Property(item => item.UserId).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.Title).HasColumnType("nvarchar(255)").HasMaxLength(255).IsRequired(true);
            entity.Property(item => item.Description).HasColumnType("nvarchar(500)").HasMaxLength(500).IsRequired(false);
            entity.Property(item => item.CreatedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.Property(item => item.UpdatedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.HasOne<User>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<Flashcard>(entity =>
        {
            entity.ToTable("Flashcards", "dbo");
            entity.HasKey(item => item.CardId);
            entity.Property(item => item.CardId).HasColumnType("int").IsRequired(true).UseIdentityColumn(1, 1);
            entity.Property(item => item.DeckId).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.FrontText).HasColumnType("nvarchar(500)").HasMaxLength(500).IsRequired(true);
            entity.Property(item => item.BackText).HasColumnType("nvarchar(1000)").HasMaxLength(1000).IsRequired(true);
            entity.Property(item => item.ExampleSentence).HasColumnType("nvarchar(1000)").HasMaxLength(1000).IsRequired(false);
            entity.Property(item => item.AudioUrl).HasColumnType("nvarchar(500)").HasMaxLength(500).IsRequired(false);
            entity.Property(item => item.ImageUrl).HasColumnType("nvarchar(500)").HasMaxLength(500).IsRequired(false);
            entity.Property(item => item.EaseFactor).HasColumnType("decimal(4,2)").HasPrecision(4, 2).IsRequired(true).HasDefaultValue(2.50m);
            entity.Property(item => item.IntervalDays).HasColumnType("int").IsRequired(true).HasDefaultValue(0);
            entity.Property(item => item.Repetition).HasColumnType("int").IsRequired(true).HasDefaultValue(0);
            entity.Property(item => item.NextReviewAt).HasColumnType("datetime2").IsRequired(false);
            entity.Property(item => item.CreatedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.Property(item => item.UpdatedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.HasOne<FlashcardDeck>().WithMany().HasForeignKey(item => item.DeckId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Bookmark>(entity =>
        {
            entity.ToTable("Bookmarks", "dbo", table =>
            {
                table.HasCheckConstraint("CK_Bookmarks_TargetType", "[TargetType] IN (N'lesson', N'writing', N'flashcard', N'course', N'vocabulary')");
            });
            entity.HasKey(item => item.BookmarkId);
            entity.Property(item => item.BookmarkId).HasColumnType("int").IsRequired(true).UseIdentityColumn(1, 1);
            entity.Property(item => item.UserId).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.TargetType).HasColumnType("nvarchar(30)").HasMaxLength(30).IsRequired(true);
            entity.Property(item => item.TargetId).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.Note).HasColumnType("nvarchar(500)").HasMaxLength(500).IsRequired(false);
            entity.Property(item => item.CreatedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.HasAlternateKey(item => new { item.UserId, item.TargetType, item.TargetId });
            entity.HasOne<User>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<LearningProgress>(entity =>
        {
            entity.ToTable("LearningProgress", "dbo");
            entity.HasKey(item => item.ProgressId);
            entity.Property(item => item.ProgressId).HasColumnType("int").IsRequired(true).UseIdentityColumn(1, 1);
            entity.Property(item => item.UserId).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.CourseId).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.LastLessonId).HasColumnType("int").IsRequired(false);
            entity.Property(item => item.LastPosition).HasColumnType("nvarchar(100)").HasMaxLength(100).IsRequired(false);
            entity.Property(item => item.UpdatedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.HasAlternateKey(item => new { item.UserId, item.CourseId });
            entity.HasOne<User>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.NoAction);
            entity.HasOne<Course>().WithMany().HasForeignKey(item => item.CourseId).OnDelete(DeleteBehavior.NoAction);
            entity.HasOne<Lesson>().WithMany().HasForeignKey(item => item.LastLessonId).OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<UploadedDocument>(entity =>
        {
            entity.ToTable("UploadedDocuments", "dbo", table =>
            {
                table.HasCheckConstraint("CK_UploadedDocuments_FileType", "[FileType] IN (N'pdf', N'png', N'jpg', N'jpeg', N'docx')");
                table.HasCheckConstraint("CK_UploadedDocuments_Status", "[Status] IN (N'processing', N'completed', N'failed')");
            });
            entity.HasKey(item => item.DocumentId);
            entity.Property(item => item.DocumentId).HasColumnType("int").IsRequired(true).UseIdentityColumn(1, 1);
            entity.Property(item => item.UserId).HasColumnType("int").IsRequired(true);
            entity.Property(item => item.OriginalFileName).HasColumnType("nvarchar(255)").HasMaxLength(255).IsRequired(true);
            entity.Property(item => item.FileUrl).HasColumnType("nvarchar(500)").HasMaxLength(500).IsRequired(true);
            entity.Property(item => item.FileType).HasColumnType("nvarchar(20)").HasMaxLength(20).IsRequired(true);
            entity.Property(item => item.ExtractedText).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(item => item.Summary).HasColumnType("nvarchar(max)").IsRequired(false);
            entity.Property(item => item.GeneratedCourseId).HasColumnType("int").IsRequired(false);
            entity.Property(item => item.Status).HasColumnType("nvarchar(20)").HasMaxLength(20).IsRequired(true).HasDefaultValue("processing");
            entity.Property(item => item.CreatedAt).HasColumnType("datetime2").IsRequired(true).HasDefaultValueSql("SYSDATETIME()");
            entity.Property(item => item.ProcessedAt).HasColumnType("datetime2").IsRequired(false);
            entity.HasOne<User>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.NoAction);
            entity.HasOne<Course>().WithMany().HasForeignKey(item => item.GeneratedCourseId).OnDelete(DeleteBehavior.NoAction);
        });

    }
}
