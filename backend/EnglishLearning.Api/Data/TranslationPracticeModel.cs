using EnglishLearning.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Data;

internal static class TranslationPracticeModel
{
    internal static void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<TranslationPrompt>(entity =>
        {
            entity.ToTable("TranslationPrompts", "dbo", table =>
            {
                table.HasCheckConstraint("CK_TranslationPrompts_CefrLevel", "[CefrLevel] COLLATE Latin1_General_100_BIN2 IN (N'A1', N'A2', N'B1')");
                table.HasCheckConstraint("CK_TranslationPrompts_Availability", "[Availability] COLLATE Latin1_General_100_BIN2 IN (N'active', N'retired', N'blocked')");
            });
            entity.HasKey(item => item.PromptId);
            entity.Property(item => item.PromptId).UseIdentityColumn();
            entity.Property(item => item.VietnameseText).HasMaxLength(500);
            entity.Property(item => item.CefrLevel).HasMaxLength(10);
            entity.Property(item => item.Topic).HasMaxLength(80);
            entity.Property(item => item.NormalizedVietnameseHash).HasColumnType("binary(32)");
            entity.Property(item => item.Availability).HasMaxLength(16);
            entity.HasIndex(item => item.NormalizedVietnameseHash).IsUnique().HasFilter("[Availability] = N'active'")
                .HasDatabaseName("UX_TranslationPrompts_ActiveHash");
            entity.HasIndex(item => item.RotationKey).IsUnique().HasFilter("[Availability] = N'active'")
                .HasDatabaseName("UX_TranslationPrompts_ActiveRotation");
        });
        modelBuilder.Entity<TranslationAcceptedAnswer>(entity =>
        {
            entity.ToTable("TranslationAcceptedAnswers", "dbo", table =>
            {
                table.HasCheckConstraint("CK_TranslationAcceptedAnswers_Source", "[Source] COLLATE Latin1_General_100_BIN2 IN (N'original', N'student')");
                table.HasCheckConstraint("CK_TranslationAcceptedAnswers_ReviewStatus", "[ReviewStatus] COLLATE Latin1_General_100_BIN2 IN (N'pending', N'approved', N'rejected')");
            });
            entity.HasKey(item => item.AnswerId);
            entity.Property(item => item.AnswerId).UseIdentityColumn();
            entity.Property(item => item.EnglishText).HasMaxLength(500);
            entity.Property(item => item.NormalizedEnglishHash).HasColumnType("binary(32)");
            entity.Property(item => item.Source).HasMaxLength(16);
            entity.Property(item => item.ReviewStatus).HasMaxLength(16);
            entity.HasOne<TranslationPrompt>().WithMany().HasForeignKey(item => item.PromptId).OnDelete(DeleteBehavior.NoAction);
            entity.HasIndex(item => new { item.PromptId, item.NormalizedEnglishHash }).IsUnique()
                .HasDatabaseName("UX_TranslationAcceptedAnswers_PromptHash");
            entity.HasIndex(item => item.PromptId).IsUnique().HasFilter("[Source] = N'original'")
                .HasDatabaseName("UX_TranslationAcceptedAnswers_Original");
        });
        modelBuilder.Entity<UserTranslationPromptExposure>(entity =>
        {
            entity.ToTable("UserTranslationPromptExposures", "dbo");
            entity.HasKey(item => new { item.UserId, item.RotationKey });
            entity.HasOne<User>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.NoAction);
        });
    }
}
