namespace EnglishLearning.Api.Entities;

public enum LearningKind
{
    Listening = 1,
    Speaking = 2,
    Reading = 3,
    Writing = 4,
    Grammar = 5,
    Flashcards = 6,
    Translation = 7,
    Vocabulary = 8
}

public sealed class UserLearningDay
{
    public int UserId { get; init; }
    public DateOnly StudyDate { get; init; }
    public LearningKind Kind { get; init; }
}
