using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services.AiCourses;

namespace EnglishLearning.Api.Services;

public sealed class CourseTextLessonException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

public sealed class CourseReadingGrading(ListeningGradingService grading)
{
    public static ReadingContent ReadContent(Lesson lesson)
    {
        try {
            var document = JsonSerializer.Deserialize<LessonContentDocument>(lesson.Content ?? "null", AiCourseStore.Json);
            if (document is not { Version: 1, Reading: { } content } || !AiCourseContent.ValidTree(content)
                || string.IsNullOrWhiteSpace(content.Passage) || content.Questions.Length == 0) throw Unsupported();
            return content;
        } catch (JsonException) { throw Unsupported(); }
    }
    public ReadingPracticeQuestion[] PublicQuestions(Lesson lesson, ReadingContent content) => grading.PublicQuestions(lesson, Adapt(content))
        .Select((question, index) => new ReadingPracticeQuestion(index, content.Questions[index].Type,
            content.Questions[index].Prompt, question.Options, question.MatchingLeft, question.MatchingRight,
            content.Questions[index].Focus, content.Questions[index].Points)).ToArray();

    public ListeningQuestionReview[] Grade(Lesson lesson, ReadingContent content, ListeningSubmissionRequest input)
    {
        if (input.ContentVersion != ListeningGradingService.ContentVersion(lesson))
            throw new CourseTextLessonException(409, "Nội dung bài đã thay đổi. Hãy tải lại bài đọc.");
        if (!AiCourseContent.ValidTree(input)) throw new CourseTextLessonException(400, "Câu trả lời chưa hợp lệ.");
        var normalized = input.Answers.Select(answer => {
            var question = answer.QuestionId >= 0 && answer.QuestionId < content.Questions.Length ? content.Questions[answer.QuestionId] : null;
            var text = answer.Text;
            if (question?.Type is "short_answer" or "fill_blank" && text is not null && question.AcceptedAnswers.Any(alias =>
                    string.Equals(alias.Trim().Normalize(), text.Trim().Normalize(), question.CaseSensitive ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase)))
                text = question.Answer;
            return new ListeningAnswer { QuestionId = answer.QuestionId, OptionIndex = answer.OptionIndex, Text = text, Matches = answer.Matches };
        }).ToArray();
        var reviews = grading.Grade(lesson, Adapt(content), new ListeningSubmissionRequest {
            ContentVersion = input.ContentVersion, Answers = normalized, TimeSpentSeconds = input.TimeSpentSeconds
        });
        return reviews.Select((review, index) => review with {
            Type = content.Questions[index].Type, Prompt = content.Questions[index].Prompt,
            SubmittedAnswer = content.Questions[index].Type is "short_answer" or "fill_blank"
                ? input.Answers.SingleOrDefault(answer => answer.QuestionId == index)?.Text?.Trim() : review.SubmittedAnswer
        }).ToArray();
    }

    private static ListeningContent Adapt(ReadingContent content) => new() {
        Questions = content.Questions.Select(question => new ListeningQuestion {
            Type = question.Type switch { "short_answer" => "fill_blank", "true_false_not_given" => "multiple_choice", _ => question.Type },
            Prompt = question.Type == "short_answer" ? question.Prompt + " [blank]" : question.Prompt,
            Options = question.Type == "true_false_not_given" ? ["True", "False", "Not Given"] : question.Options,
            CorrectOptionIndex = question.Type == "true_false_not_given" ? question.Answer switch { "true" => 0, "false" => 1, _ => 2 } : question.CorrectOptionIndex,
            Answer = question.Answer, CaseSensitive = question.CaseSensitive, Explanation = question.Explanation, Pairs = question.Pairs
        }).ToArray()
    };
    private static CourseTextLessonException Unsupported() => new(409, "Nội dung bài đọc đang được hoàn thiện.");
}
