using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Services;

public sealed class TranslationBankCommand(EnglishLearningDbContext db, TranslationAiClient ai, IConfiguration config)
{
    private static readonly JsonSerializerOptions Output = new(TranslationPracticeSupport.Json) { WriteIndented = true };

    public async Task RunAsync(string command, CancellationToken ct)
    {
        switch (command)
        {
            case "generate":
                await GenerateAsync(ct);
                break;
            case "import":
            case "replace":
                await ImportAsync(command == "replace" ? PositiveId("translation-prompt-id") : null, ct);
                break;
            case "list-pending":
                var after = config.GetValue<int>("translation-after");
                var pending = await (from answer in db.TranslationAcceptedAnswers.AsNoTracking()
                    join prompt in db.TranslationPrompts.AsNoTracking() on answer.PromptId equals prompt.PromptId
                    where prompt.Availability == "active" && answer.Source == "student" && answer.ReviewStatus == "pending" && answer.AnswerId > after
                    orderby answer.AnswerId
                    select new { answer.AnswerId, answer.PromptId, prompt.CefrLevel, prompt.VietnameseText,
                        MeaningNotes = prompt.MeaningNotesJson, answer.EnglishText }).Take(50).ToArrayAsync(ct);
                Console.WriteLine(JsonSerializer.Serialize(pending.Select(item => new { item.AnswerId, item.PromptId,
                    item.CefrLevel, item.VietnameseText, MeaningNotes = JsonSerializer.Deserialize<string[]>(item.MeaningNotes), item.EnglishText }), Output));
                break;
            case "approve":
            case "reject":
                var answerId = PositiveId("translation-answer-id");
                var status = command == "approve" ? "approved" : "rejected";
                var changed = await db.TranslationAcceptedAnswers.Where(answer => answer.AnswerId == answerId &&
                    answer.Source == "student" && answer.ReviewStatus == "pending" && db.TranslationPrompts.Any(prompt =>
                        prompt.PromptId == answer.PromptId && prompt.Availability == "active"))
                    .ExecuteUpdateAsync(update => update.SetProperty(answer => answer.ReviewStatus, status), ct);
                if (changed != 1) throw new ArgumentException("No pending answer with this ID on an active prompt.");
                Console.WriteLine($"Answer {answerId}: {status}.");
                break;
            case "block":
                var promptId = PositiveId("translation-prompt-id");
                await using (var transaction = await db.Database.BeginTransactionAsync(ct))
                {
                    await TranslationPracticeSupport.LockAsync(db, "translation:bank", ct);
                    var blocked = await db.TranslationPrompts.Where(prompt => prompt.PromptId == promptId)
                        .ExecuteUpdateAsync(update => update.SetProperty(prompt => prompt.Availability, "blocked"), ct);
                    if (blocked != 1) throw new ArgumentException("Prompt ID not found.");
                    await transaction.CommitAsync(ct);
                }
                Console.WriteLine($"Prompt {promptId}: blocked.");
                break;
            default:
                throw new ArgumentException("Use --translation-command=generate|import|replace|list-pending|approve|reject|block.");
        }
    }

    private async Task GenerateAsync(CancellationToken ct)
    {
        var level = config["translation-level"];
        var topic = config["translation-topic"]?.Trim();
        var count = config.GetValue("translation-count", 5);
        var path = FilePath();
        if (!TranslationPracticeSupport.ValidLevel(level) || !IsText(topic, 80) || count is < 1 or > 10)
            throw new ArgumentException("Supply a level A1/A2/B1, a topic of at most 80 characters, and a count from 1 to 10.");
        if (File.Exists(path)) throw new IOException("The review file already exists. Choose a new file name.");
        var batch = await ai.GenerateAsync(level!, topic!, count, ct);
        Validate(batch);
        if (batch.Prompts.Length != count || batch.Prompts.Any(prompt => prompt.Level != level || prompt.Topic != topic))
            throw new ArgumentException("The generated batch did not match the requested count, topic or level.");
        await using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write);
        await JsonSerializer.SerializeAsync(output, batch, Output, ct);
        Console.WriteLine($"Generated {count} prompts. Review the JSON before importing it.");
    }

    private async Task ImportAsync(int? replaceId, CancellationToken ct)
    {
        var path = FilePath();
        if (new FileInfo(path).Length > 512 * 1024) throw new ArgumentException("The review file exceeds 512 KiB.");
        await using var input = File.OpenRead(path);
        var batch = await JsonSerializer.DeserializeAsync<TranslationDraftBatch>(input, TranslationPracticeSupport.Json, ct);
        Validate(batch);
        if (replaceId is not null && batch!.Prompts.Length != 1)
            throw new ArgumentException("A replacement file must contain exactly one prompt.");

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await TranslationPracticeSupport.LockAsync(db, "translation:bank", ct);
        TranslationPrompt? replaced = null;
        if (replaceId is { } oldId)
        {
            replaced = await db.TranslationPrompts.SingleOrDefaultAsync(prompt => prompt.PromptId == oldId && prompt.Availability == "active", ct)
                ?? throw new ArgumentException("Only an active prompt can be replaced.");
            replaced.Availability = "retired";
            await db.SaveChangesAsync(ct);
        }

        var added = new List<(TranslationPrompt Prompt, TranslationPromptDraft Draft)>();
        foreach (var draft in batch!.Prompts)
        {
            var hash = TranslationPracticeSupport.PromptHash(draft.VietnameseText);
            if (await db.TranslationPrompts.AnyAsync(item => item.Availability == "active" && item.NormalizedVietnameseHash == hash, ct))
            {
                if (replaceId is not null) throw new ArgumentException("The replacement duplicates another active prompt.");
                continue;
            }
            // Previously blocked or retired text still represents the same exercise in a learner's history.
            if (replaced is null && await db.TranslationPrompts.AnyAsync(item => item.NormalizedVietnameseHash == hash, ct))
                throw new ArgumentException("A draft duplicates inactive content. Review it before creating another prompt.");
            var prompt = new TranslationPrompt
            {
                RotationKey = replaced?.RotationKey ?? Guid.NewGuid(), VietnameseText = draft.VietnameseText.Trim(),
                Topic = draft.Topic.Trim(), CefrLevel = draft.Level, Availability = "active", NormalizedVietnameseHash = hash,
                MeaningNotesJson = JsonSerializer.Serialize(draft.MeaningNotes.Select(note => note.Trim()), TranslationPracticeSupport.Json)
            };
            db.TranslationPrompts.Add(prompt);
            added.Add((prompt, draft));
        }
        await db.SaveChangesAsync(ct);
        foreach (var (prompt, draft) in added)
            db.TranslationAcceptedAnswers.Add(new() { PromptId = prompt.PromptId, EnglishText = draft.EnglishReference.Trim(),
                NormalizedEnglishHash = TranslationPracticeSupport.AnswerHash(draft.EnglishReference), Source = "original", ReviewStatus = "approved" });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        Console.WriteLine($"Imported {added.Count} prompt(s), skipped {batch.Prompts.Length - added.Count} duplicate(s).");
    }

    private string FilePath() => config["translation-file"] is { Length: > 0 } path
        ? Path.GetFullPath(path) : throw new ArgumentException("Supply --translation-file=<path-to-json>.");

    private int PositiveId(string key) => config.GetValue<int>(key) is > 0 and var value
        ? value : throw new ArgumentException($"Supply --{key}=<positive-id>.");

    private static void Validate(TranslationDraftBatch? batch)
    {
        if (batch?.Prompts is not { Length: >= 1 and <= 200 } || batch.Prompts.Any(draft => draft is null ||
            !TranslationPracticeSupport.ValidLevel(draft.Level) || !IsText(draft.Topic, 80) || !IsText(draft.VietnameseText, 500) ||
            !draft.VietnameseText.Any(char.IsLetter) || !IsText(draft.EnglishReference, 500) || !draft.EnglishReference.Any(char.IsLetter) ||
            draft.MeaningNotes is not { Length: >= 1 and <= 8 } || draft.MeaningNotes.Any(note => !IsText(note, 200))))
            throw new ArgumentException("Each draft needs a level, topic, Vietnamese sentence, English reference and 1–8 meaning notes.");
        if (batch.Prompts.Select(draft => Convert.ToHexString(TranslationPracticeSupport.PromptHash(draft.VietnameseText)))
            .Distinct().Count() != batch.Prompts.Length)
            throw new ArgumentException("The batch contains duplicate Vietnamese prompts.");
    }

    private static bool IsText(string? text, int limit) => !string.IsNullOrWhiteSpace(text) && text.Length <= limit && !text.Any(char.IsControl);
}
