namespace EnglishLearning.Api.Entities;

public sealed class ExerciseResult
{
    public int ResultId { get; set; }
    public int UserId { get; set; }
    public int LessonId { get; set; }
    public decimal Score { get; set; }
    public int TotalQuestions { get; set; }
    public int CorrectAnswers { get; set; }
    public string? WrongAnswersJson { get; set; }
    public int? TimeSpentSeconds { get; set; }
    public DateTime SubmittedAt { get; set; }
}
