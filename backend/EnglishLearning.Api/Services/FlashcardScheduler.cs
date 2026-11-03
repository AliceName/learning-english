using EnglishLearning.Api.Entities;

namespace EnglishLearning.Api.Services;

public static class FlashcardScheduler
{
    // SM-2-style practice schedule. Four self-reported ratings, not an AI assessment.
    public static void Review(Flashcard card, int rating, DateTime now)
    {
        if (rating is < 0 or > 3) throw new ArgumentOutOfRangeException(nameof(rating));
        var quality = new[] { 1, 3, 4, 5 }[rating];
        var delta = .1m - (5 - quality) * (.08m + (5 - quality) * .02m);
        var ease = Math.Clamp(card.EaseFactor + delta, 1.30m, 9.99m);
        if (rating == 0)
        {
            card.Repetition = 0; card.IntervalDays = 0; card.NextReviewAt = now.AddMinutes(5);
        }
        else
        {
            var days = card.Repetition == 0 ? 1 : card.Repetition == 1 ? 6 : (int)Math.Clamp(decimal.Round(card.IntervalDays * card.EaseFactor), 1m, 3650m);
            card.Repetition = Math.Min(card.Repetition + 1, 10000);
            card.IntervalDays = days; card.NextReviewAt = now.AddDays(days);
        }
        card.EaseFactor = ease; card.UpdatedAt = now;
    }
}
