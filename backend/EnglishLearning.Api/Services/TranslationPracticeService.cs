using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

public sealed class TranslationPracticeService(EnglishLearningDbContext db, TranslationAiClient ai,
    IDataProtectionProvider protection, TimeProvider time, IConfiguration config, ILogger<TranslationPracticeService> logger)
{
    private const int MinimumNaturalnessForCandidate = 13;
    private readonly ITimeLimitedDataProtector attempts = protection.CreateProtector("TranslationPractice.Attempt.v1").ToTimeLimitedDataProtector();

    public async Task<TranslationPromptResponse> NextAsync(int userId, string level, bool review, CancellationToken ct)
    {
        if (!TranslationPracticeSupport.ValidLevel(level))
            throw new TranslationPracticeException(400, "invalid_level", "Hãy chọn cấp độ A1, A2 hoặc B1.");

        var stopwatch = Stopwatch.StartNew();
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await TranslationPracticeSupport.LockAsync(db, $"translation:exposure:{userId}", ct);
        var now = time.GetUtcNow().UtcDateTime;
        var cooldown = Math.Clamp(config.GetValue("TranslationPractice:CooldownDays", 7), 1, 90);
        var cutoff = now.AddDays(-cooldown);

        var choices = from prompt in db.TranslationPrompts.AsNoTracking()
                      where prompt.CefrLevel == level && prompt.Availability == "active"
                      join exposure in db.UserTranslationPromptExposures.AsNoTracking().Where(item => item.UserId == userId)
                          on prompt.RotationKey equals exposure.RotationKey into history
                      from exposure in history.DefaultIfEmpty()
                      select new { Prompt = prompt, LastShown = (DateTime?)exposure.LastShownAtUtc };

        var selected = await choices.Where(item => item.LastShown == null).OrderBy(_ => Guid.NewGuid()).FirstOrDefaultAsync(ct);
        if (selected is null)
        {
            selected = await choices.Where(item => review || item.LastShown <= cutoff)
                .OrderBy(item => item.LastShown).ThenBy(item => item.Prompt.PromptId).FirstOrDefaultAsync(ct);
            if (selected is null)
            {
                if (await choices.AnyAsync(ct))
                    throw new TranslationPracticeException(409, "review_available", "Bạn đã gặp các câu ở cấp độ này gần đây. Hãy ôn lại hoặc chọn cấp độ khác.");
                throw new TranslationPracticeException(404, "level_empty", "Cấp độ này chưa có câu để luyện. Hãy thử cấp độ khác.");
            }
        }

        var promptToShow = selected.Prompt;
        var exposureToUpdate = await db.UserTranslationPromptExposures.FindAsync([userId, promptToShow.RotationKey], ct);
        if (exposureToUpdate is null)
            db.UserTranslationPromptExposures.Add(new() { UserId = userId, RotationKey = promptToShow.RotationKey, LastShownAtUtc = now });
        else exposureToUpdate.LastShownAtUtc = now;

        var token = attempts.Protect($"{userId}:{promptToShow.PromptId}", TimeSpan.FromHours(4));
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        logger.LogInformation("Translation prompt {Level}, repeat={Repeat}, review={Review}, served in {ElapsedMs} ms.",
            level, selected.LastShown is not null, review, stopwatch.ElapsedMilliseconds);
        return new(promptToShow.PromptId, level, promptToShow.Topic, promptToShow.VietnameseText, token);
    }

    public async Task<TranslationGradeResponse> GradeAsync(int userId, TranslationGradeRequest request, CancellationToken ct)
    {
        var answer = request.Answer.Trim();
        if (answer.Length == 0 || answer.Any(char.IsControl))
            throw new TranslationPracticeException(400, "invalid_answer", "Hãy nhập một câu tiếng Anh trên một dòng.");

        var promptId = ReadPromptId(userId, request.AttemptToken);
        var prompt = await db.TranslationPrompts.AsNoTracking().SingleOrDefaultAsync(item => item.PromptId == promptId, ct);
        if (prompt is null || prompt.Availability == "blocked") throw UnavailablePrompt();

        var hash = TranslationPracticeSupport.AnswerHash(answer);
        var approved = db.TranslationAcceptedAnswers.AsNoTracking()
            .Where(item => item.PromptId == promptId && item.ReviewStatus == "approved");
        var known = await approved.AnyAsync(item => item.NormalizedEnglishHash == hash, ct);
        var examples = await approved.OrderByDescending(item => item.Source == "original")
            .ThenByDescending(item => item.NormalizedEnglishHash == hash).ThenBy(item => item.AnswerId)
            .Select(item => item.EnglishText).Take(3).ToArrayAsync(ct);
        if (known && !request.IncludeAiFeedback)
        {
            logger.LogInformation("Translation grade {Level} matched an approved answer.", prompt.CefrLevel);
            return new("approved", null, true, true, "Bản dịch khớp một cách diễn đạt đã được xác nhận.", null, null, [], examples, "none");
        }

        var notes = JsonSerializer.Deserialize<string[]>(prompt.MeaningNotesJson, TranslationPracticeSupport.Json) ?? [];
        var grade = await ai.GradeAsync(new(prompt.PromptId, prompt.CefrLevel, prompt.Topic, prompt.VietnameseText, ""),
            notes, examples, answer, ct);
        if (known && (!grade.MeaningCorrect || !grade.GrammarCorrect))
            throw TranslationAiClient.InvalidResponse();
        if (await db.TranslationPrompts.AnyAsync(item => item.PromptId == promptId && item.Availability == "blocked", ct))
            throw UnavailablePrompt();

        var candidateStatus = !known && grade.MeaningCorrect && grade.GrammarCorrect && grade.Naturalness >= MinimumNaturalnessForCandidate
            ? await SaveCandidateAsync(promptId, request.Answer, hash, ct) : "none";
        var score = grade.Meaning + grade.Grammar + grade.Naturalness;
        if (grade.MajorMeaningError) score = Math.Min(score, 49);
        return new("scored", score, grade.MeaningCorrect, grade.GrammarCorrect, grade.Feedback,
            grade.CorrectedText, new(grade.Meaning, grade.Grammar, grade.Naturalness), grade.Issues, examples,
            candidateStatus, grade.CorrectionExplanation, grade.Alternative);
    }

    private int ReadPromptId(int userId, string token)
    {
        string[]? fields;
        try { fields = attempts.Unprotect(token).Split(':'); }
        catch (CryptographicException) { throw UnavailablePrompt(); }
        if (fields is not [var owner, var id] || !int.TryParse(owner, out var ownerId) || ownerId != userId ||
            !int.TryParse(id, out var promptId) || promptId <= 0)
            throw UnavailablePrompt();
        return promptId;
    }

    private async Task<string> SaveCandidateAsync(int promptId, string originalAnswer, byte[] hash, CancellationToken ct)
    {
        var matching = db.TranslationAcceptedAnswers.AsNoTracking()
            .Where(item => item.PromptId == promptId && item.NormalizedEnglishHash == hash);
        var existing = await matching.Select(item => item.ReviewStatus).SingleOrDefaultAsync(ct);
        if (existing is not null) return existing == "pending" ? "pending" : "none";

        db.TranslationAcceptedAnswers.Add(new() { PromptId = promptId, EnglishText = originalAnswer,
            NormalizedEnglishHash = hash, Source = "student", ReviewStatus = "pending" });
        try
        {
            await db.SaveChangesAsync(ct);
            return "pending";
        }
        catch (DbUpdateException error) when (error.InnerException is SqlException { Number: 2601 or 2627 })
        {
            return await matching.AnyAsync(item => item.ReviewStatus == "pending", ct) ? "pending" : "none";
        }
        catch (DbUpdateException)
        {
            logger.LogWarning("Unable to save a translation answer candidate.");
            return "unavailable";
        }
    }

    private static TranslationPracticeException UnavailablePrompt() =>
        new(409, "prompt_unavailable", "Lượt luyện đã hết hạn hoặc đề đã ngừng sử dụng. Hãy lấy câu mới.");
}
