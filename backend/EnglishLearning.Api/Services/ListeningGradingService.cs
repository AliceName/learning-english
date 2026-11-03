using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Entities;
using Microsoft.AspNetCore.DataProtection;

namespace EnglishLearning.Api.Services;

public sealed class ListeningPracticeException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

public sealed class ListeningGradingService(IDataProtectionProvider protection)
{
    private readonly IDataProtector choices = protection.CreateProtector("Listening.MatchingChoices.v1");
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static ListeningContent ReadContent(Lesson lesson)
    {
        LessonContentDocument? document;
        try { document = JsonSerializer.Deserialize<LessonContentDocument>(lesson.Content ?? "null", JsonOptions); }
        catch (JsonException) { throw Unsupported(); }
        var content = document?.Listening;
        if (document?.Version != 1 || content is null || string.IsNullOrWhiteSpace(lesson.AudioUrl) ||
            !new MediaUrlAttribute().IsValid(lesson.AudioUrl) || string.IsNullOrWhiteSpace(content.Transcript) ||
            !Valid(content) || content.Questions.Length == 0 || content.Questions.Any(question =>
                question is null || !Valid(question) || string.IsNullOrWhiteSpace(question.Prompt) ||
                question.Pairs is null || question.Pairs.Any(pair => pair is null || !Valid(pair))))
            throw Unsupported();
        return content;
    }

    private static bool Valid(object value) => Validator.TryValidateObject(value, new ValidationContext(value), [], true);
    private static ListeningPracticeException Unsupported() => new(409, "Nội dung bài nghe chưa sẵn sàng hoặc có định dạng chưa được hỗ trợ.");
    public static string ContentVersion(Lesson lesson) => Convert.ToHexString(SHA256.HashData(
        Encoding.UTF8.GetBytes($"{lesson.LessonId}\n{lesson.AudioUrl}\n{lesson.Content}")));

    public ListeningPracticeQuestion[] PublicQuestions(Lesson lesson, ListeningContent content) =>
        content.Questions.Select((question, index) =>
        {
            var right = question.Type == "matching" ? question.Pairs.Select((pair, pairIndex) =>
                new ListeningMatchOption(choices.Protect($"{lesson.LessonId}:{index}:{pairIndex}"), pair.Right)).ToArray() : [];
            for (var end = right.Length - 1; end > 0; end--)
            {
                var other = RandomNumberGenerator.GetInt32(end + 1);
                (right[end], right[other]) = (right[other], right[end]);
            }
            return new ListeningPracticeQuestion(index, question.Type, question.Prompt,
                question.Type == "multiple_choice" ? question.Options : [],
                question.Type == "matching" ? question.Pairs.Select(pair => pair.Left).ToArray() : [], right, question.AtSeconds);
        }).ToArray();

    public ListeningQuestionReview[] Grade(Lesson lesson, ListeningContent content, ListeningSubmissionRequest request)
    {
        if (request.ContentVersion != ContentVersion(lesson))
            throw new ListeningPracticeException(409, "Nội dung bài đã thay đổi. Vui lòng tải lại bài nghe.");
        if (!Valid(request) || request.Answers.Any(answer => answer is null || !Valid(answer) ||
                answer.QuestionId >= content.Questions.Length || answer.Matches.Any(match => match is null || !Valid(match))) ||
            request.Answers.Select(answer => answer.QuestionId).Distinct().Count() != request.Answers.Length)
            throw InvalidAnswer();
        var submitted = request.Answers.ToDictionary(answer => answer.QuestionId);
        return content.Questions.Select((question, index) =>
        {
            submitted.TryGetValue(index, out var answer);
            string? actual = null;
            string expected;
            bool correct;
            ListeningPairReview[] pairs = [];
            switch (question.Type)
            {
                case "multiple_choice":
                    if (answer is not null && (answer.Text is not null || answer.Matches.Length > 0 || answer.OptionIndex >= question.Options.Length))
                        throw InvalidAnswer();
                    actual = answer?.OptionIndex is int selected ? question.Options[selected] : null;
                    expected = question.Options[question.CorrectOptionIndex!.Value];
                    correct = answer?.OptionIndex == question.CorrectOptionIndex;
                    break;
                case "fill_blank":
                    if (answer is not null && (answer.OptionIndex is not null || answer.Matches.Length > 0)) throw InvalidAnswer();
                    actual = string.IsNullOrWhiteSpace(answer?.Text) ? null : answer.Text.Trim().Normalize();
                    expected = question.Answer!.Trim().Normalize();
                    correct = actual is not null && string.Equals(actual, expected,
                        question.CaseSensitive ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase);
                    break;
                case "matching":
                    if (answer is not null && (answer.OptionIndex is not null || answer.Text is not null ||
                        answer.Matches.Any(match => match.LeftIndex >= question.Pairs.Length) ||
                        answer.Matches.Select(match => match.LeftIndex).Distinct().Count() != answer.Matches.Length)) throw InvalidAnswer();
                    var selections = (answer?.Matches ?? []).ToDictionary(match => match.LeftIndex,
                        match => DecodeRight(lesson.LessonId, index, match.RightId, question.Pairs));
                    pairs = question.Pairs.Select((pair, pairIndex) =>
                    {
                        selections.TryGetValue(pairIndex, out var text);
                        return new ListeningPairReview(pair.Left, text, pair.Right, text == pair.Right);
                    }).ToArray();
                    correct = pairs.All(pair => pair.Correct);
                    expected = string.Join("; ", pairs.Select(pair => $"{pair.Left} → {pair.CorrectAnswer}"));
                    actual = selections.Count == 0 ? null : string.Join("; ", pairs.Select(pair => $"{pair.Left} → {pair.SubmittedAnswer ?? "(bỏ trống)"}"));
                    break;
                default: throw Unsupported();
            }
            return new ListeningQuestionReview(index, question.Type, question.Prompt, correct, actual,
                expected, question.Explanation, question.AtSeconds, pairs);
        }).ToArray();
    }

    private string DecodeRight(int lessonId, int questionId, string token, MatchingPair[] pairs)
    {
        try
        {
            var parts = choices.Unprotect(token).Split(':');
            if (parts.Length == 3 && parts[0] == lessonId.ToString() && parts[1] == questionId.ToString() &&
                int.TryParse(parts[2], out var index) && index >= 0 && index < pairs.Length) return pairs[index].Right;
        }
        catch (CryptographicException) { }
        throw InvalidAnswer();
    }

    private static ListeningPracticeException InvalidAnswer() => new(400, "Câu trả lời không hợp lệ. Vui lòng kiểm tra và thử lại.");
}
