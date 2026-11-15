using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Entities;

namespace EnglishLearning.Api.Services;

public sealed class GrammarPracticeException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

public static class GrammarGradingService
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static GrammarContent ReadContent(Lesson lesson)
    {
        LessonContentDocument? document;
        try { document = JsonSerializer.Deserialize<LessonContentDocument>(lesson.Content ?? "null", JsonOptions); }
        catch (JsonException) { throw Unsupported(); }
        var content = document?.Grammar;
        if (document?.Version != 1 || content is null || !Valid(content) ||
            string.IsNullOrWhiteSpace(content.Topic) || string.IsNullOrWhiteSpace(content.Rules) ||
            content.Questions.Length == 0 || content.Questions.Any(question => question is null || !Valid(question)))
            throw Unsupported();
        return content;
    }

    public static string ContentVersion(Lesson lesson) => Convert.ToHexString(SHA256.HashData(
        Encoding.UTF8.GetBytes($"{lesson.LessonId}\n{lesson.Content}")));

    public static GrammarPracticeQuestion[] PublicQuestions(GrammarContent content) => content.Questions
        .Select((question, index) => new GrammarPracticeQuestion(index, question.Type, question.Prompt,
            question.Type == "fill_blank" ? [] : question.Options, question.Tag)).ToArray();

    public static GrammarQuestionReview[] Grade(Lesson lesson, GrammarContent content, GrammarSubmissionRequest request)
    {
        if (request.ContentVersion != ContentVersion(lesson))
            throw new GrammarPracticeException(409, "Nội dung bài đã thay đổi. Vui lòng tải lại bài ngữ pháp.");
        if (!Valid(request) || request.Answers.Any(answer => answer is null || !Valid(answer) ||
                answer.QuestionId >= content.Questions.Length) ||
            request.Answers.Select(answer => answer.QuestionId).Distinct().Count() != request.Answers.Length)
            throw InvalidAnswer();
        var submitted = request.Answers.ToDictionary(answer => answer.QuestionId);
        return content.Questions.Select((question, index) =>
        {
            submitted.TryGetValue(index, out var answer);
            string? actual;
            string expected;
            bool correct;
            if (question.Type == "fill_blank")
            {
                if (answer?.OptionIndex is not null) throw InvalidAnswer();
                actual = string.IsNullOrWhiteSpace(answer?.Text) ? null : answer.Text.Trim().Normalize();
                expected = question.Answer!.Trim().Normalize();
                correct = actual is not null && new[] { expected }.Concat(question.AcceptedAnswers)
                    .Any(candidate => string.Equals(actual, candidate.Trim().Normalize(),
                        question.CaseSensitive ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase));
            }
            else
            {
                if (answer is not null && (answer.Text is not null || answer.OptionIndex >= question.Options.Length))
                    throw InvalidAnswer();
                actual = answer?.OptionIndex is int selected ? question.Options[selected] : null;
                expected = question.Options[question.CorrectOptionIndex!.Value];
                correct = answer?.OptionIndex == question.CorrectOptionIndex;
            }
            return new GrammarQuestionReview(index, correct, actual, expected,
                question.Type == "fill_blank" ? null : question.CorrectOptionIndex,
                question.Type == "error_correction" ? question.Correction : null, question.Explanation);
        }).ToArray();
    }

    private static bool Valid(object value) => Validator.TryValidateObject(value, new ValidationContext(value), [], true);
    private static GrammarPracticeException InvalidAnswer() => new(400, "Câu trả lời không hợp lệ. Vui lòng kiểm tra và thử lại.");
    private static GrammarPracticeException Unsupported() => new(409, "Nội dung bài ngữ pháp đang được hoàn thiện.");
}
