using EnglishLearning.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Conventions;

namespace EnglishLearning.Api.Data;

public sealed class EnglishLearningDbContext(
    DbContextOptions<EnglishLearningDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<UserLearningDay> UserLearningDays => Set<UserLearningDay>();
    public DbSet<Course> Courses => Set<Course>();
    public DbSet<UserCourse> UserCourses => Set<UserCourse>();
    public DbSet<Lesson> Lessons => Set<Lesson>();
    public DbSet<SpeakingAttempt> SpeakingAttempts => Set<SpeakingAttempt>();
    public DbSet<WritingSubmission> WritingSubmissions => Set<WritingSubmission>();
    public DbSet<ExerciseResult> ExerciseResults => Set<ExerciseResult>();
    public DbSet<ErrorLog> ErrorLogs => Set<ErrorLog>();
    public DbSet<FlashcardDeck> FlashcardDecks => Set<FlashcardDeck>();
    public DbSet<Flashcard> Flashcards => Set<Flashcard>();
    public DbSet<Bookmark> Bookmarks => Set<Bookmark>();
    public DbSet<Entities.LearningProgress> LearningProgress => Set<Entities.LearningProgress>();
    public DbSet<UploadedDocument> UploadedDocuments => Set<UploadedDocument>();
    public DbSet<TranslationPrompt> TranslationPrompts => Set<TranslationPrompt>();
    public DbSet<TranslationAcceptedAnswer> TranslationAcceptedAnswers => Set<TranslationAcceptedAnswer>();
    public DbSet<UserTranslationPromptExposure> UserTranslationPromptExposures => Set<UserTranslationPromptExposure>();

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        // The approved schema permits only primary keys and the specified UNIQUE constraints.
        configurationBuilder.Conventions.Remove(typeof(ForeignKeyIndexConvention));
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        EnglishLearningModel.Configure(modelBuilder);
        TranslationPracticeModel.Configure(modelBuilder);
        var activity = modelBuilder.Entity<UserLearningDay>();
        activity.ToTable("UserLearningDays", "dbo", table =>
            table.HasCheckConstraint("CK_UserLearningDays_Kind", "[Kind] BETWEEN 1 AND 8"));
        activity.HasKey(item => new { item.UserId, item.StudyDate, item.Kind });
        activity.HasOne<User>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.NoAction);
    }
}
