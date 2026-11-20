using System.Collections;
using System.ComponentModel.DataAnnotations;
using System.Text.RegularExpressions;

namespace EnglishLearning.Api.Services.AiCourses;

internal static class AiCourseValidation
{
    internal static AiContentIssue[] FindIssues(AiOutlineLesson lesson, int questionCount)
    {
        var contents = new object?[] { lesson.Listening, lesson.Speaking, lesson.Reading, lesson.Writing, lesson.Grammar };
        if (!lesson.HasContent || contents.Count(value => value is not null) != 1)
            return [new("content_shape", "$", "Nội dung không khớp kỹ năng", "Return exactly the selected skill's content object.")];
        var issues = TreeIssues(contents.Single(value => value is not null)!);
        void Require(bool valid, string code, string path, string message, string hint) {
            if (!valid && issues.Count < 12) issues.Add(new(code, path, message, hint));
        }
        void Required(string? value, string path) => Require(!string.IsNullOrWhiteSpace(value), "required_text", path, "Thiếu nội dung bắt buộc", "Provide nonempty text at this field.");
        void Questions<T>(T[]? values, Func<T, (string Type, string Prompt, string[] Options, int? Correct, string? Answer, string? Explanation)> fields) where T : class
        {
            Require(values?.Length == questionCount, "question_count", "$.questions", $"Cần đúng {questionCount} câu hỏi", $"Return exactly {questionCount} questions.");
            if (values is null) return;
            for (var i = 0; i < values.Length; i++) {
                if (values[i] is null) continue;
                var q = fields(values[i]); var path = $"$.questions[{i}]";
                Required(q.Explanation, path + ".explanation");
                Require(q.Type is "multiple_choice" or "fill_blank", "question_type", path + ".type", "Loại câu hỏi chưa được hỗ trợ", "Use multiple_choice or fill_blank.");
                if (q.Type == "multiple_choice") {
                    Require(q.Options is { Length: >= 2 and <= 4 } && q.Options.All(value => !string.IsNullOrWhiteSpace(value))
                        && q.Options.Select(value => value.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Count() == q.Options.Length,
                        "choice_options", path + ".options", "Lựa chọn cần có 2–4 đáp án khác nhau", "Provide 2-4 distinct nonempty options.");
                    Require(q.Correct is >= 0 && q.Options is not null && q.Correct < q.Options.Length,
                        "choice_index", path + ".correctOptionIndex", "Chỉ số đáp án đúng không khớp lựa chọn", "Use a zero-based index of an existing option.");
                }
                if (q.Type == "fill_blank") {
                    Require(q.Options is { Length: 0 } && q.Correct is null, "blank_options", path + ".options", "Câu điền từ không dùng lựa chọn trắc nghiệm", "Set options to [] and correctOptionIndex to null.");
                    Require(q.Prompt?.Split("[blank]").Length == 2, "blank_placeholder", path + ".prompt", "Câu điền từ cần đúng một [blank]", "Include exactly one literal [blank] in the prompt.");
                    Required(q.Answer, path + ".answer");
                }
            }
        }
        switch (lesson.SkillType) {
            case "listening":
                var listening = lesson.Listening!; Required(listening.Transcript, "$.transcript");
                Require(listening.Transcript is { Length: <= 6000 }, "transcript_length", "$.transcript", "Bài nghe vượt giới hạn 6.000 ký tự", "Keep the transcript below 6000 characters.");
                Questions(listening.Questions, q => (q.Type, q.Prompt, q.Options, q.CorrectOptionIndex, q.Answer, q.Explanation)); break;
            case "speaking":
                var speaking = lesson.Speaking!; Required(speaking.Goals, "$.goals");
                Require(speaking.Sentences?.Length == questionCount, "sentence_count", "$.sentences", $"Cần đúng {questionCount} câu luyện nói", $"Return exactly {questionCount} sentences.");
                for (var i = 0; i < (speaking.Sentences?.Length ?? 0); i++) {
                    var sentence = speaking.Sentences![i];
                    if (sentence is not null) Require(SpeakingReferenceText.GetError(sentence.Text) is null && sentence.AudioUrl is null,
                        "speaking_sentence", $"$.sentences[{i}].text", "Câu luyện nói chưa hợp lệ", "Use an English sentence of 1-35 words and at most 300 characters; write numbers as words and omit audio URLs.");
                }
                break;
            case "reading":
                var reading = lesson.Reading!; Required(reading.PassageTitle, "$.passageTitle"); Required(reading.Passage, "$.passage"); Required(reading.Translation, "$.translation");
                Require(reading.ImageUrl is null, "unexpected_media", "$.imageUrl", "Không dùng URL ảnh do AI tự tạo", "Omit imageUrl.");
                Require(reading.Vocabulary is { Length: >= 1 and <= 10 }, "vocabulary_count", "$.vocabulary", "Cần 1–10 mục từ vựng", "Return 3-6 vocabulary entries.");
                Questions(reading.Questions, q => (q.Type, q.Prompt, q.Options, q.CorrectOptionIndex, q.Answer, q.Explanation));
                for (var i = 0; i < (reading.Questions?.Length ?? 0); i++) {
                    var q = reading.Questions![i];
                    if (q is not null) Require(!string.IsNullOrWhiteSpace(q.Reference) && NormalizeQuote(reading.Passage ?? "").Contains(NormalizeQuote(q.Reference), StringComparison.OrdinalIgnoreCase),
                        "reference_mismatch", $"$.questions[{i}].reference", $"Dẫn chứng câu {i + 1} không khớp bài đọc", "Copy an exact contiguous quote from your own passage proving this answer. Do not paraphrase, shorten with ellipsis or add quotation marks.");
                }
                break;
            case "grammar":
                var grammar = lesson.Grammar!; Required(grammar.Topic, "$.topic"); Required(grammar.Rules, "$.rules");
                Questions(grammar.Questions, q => (q.Type, q.Prompt, q.Options, q.CorrectOptionIndex, q.Answer, q.Explanation)); break;
            case "writing":
                var writing = lesson.Writing!; Required(writing.Topic, "$.topic"); Required(writing.Prompt, "$.prompt"); Required(writing.Instructions, "$.instructions"); Required(writing.SampleAnswer, "$.sampleAnswer");
                Require(writing.Rubric is { Length: >= 1 and <= 8 }, "rubric_count", "$.rubric", "Thiếu tiêu chí đánh giá bài viết", "Return four rubric entries, each with weight 25; total weight must equal 100."); break;
        }
        return issues.Take(12).ToArray();
    }

    // Only typography/whitespace is normalized; words, order and other punctuation
    // are preserved, so fabricated or paraphrased evidence still fails.
    private static string NormalizeQuote(string value) => Regex.Replace(value.Replace('’', '\'').Replace('‘', '\'').Replace('“', '"').Replace('”', '"'), @"\s+", " ").Trim();

    internal static List<AiContentIssue> TreeIssues(object value)
    {
        var issues = new List<AiContentIssue>();
        void Visit(object item, string path) {
            if (issues.Count >= 12) return;
            var results = new List<ValidationResult>();
            Validator.TryValidateObject(item, new ValidationContext(item), results, true);
            foreach (var result in results) foreach (var member in result.MemberNames.DefaultIfEmpty("")) {
                var field = string.IsNullOrEmpty(member) ? path : path + "." + char.ToLowerInvariant(member[0]) + member[1..];
                if (issues.Count < 12) issues.Add(new("field_constraints", field, "Trường dữ liệu không đúng định dạng hoặc giới hạn", "Check required text, supported values, lengths and field relationships against the schema and instructions."));
            }
            foreach (var property in item.GetType().GetProperties()) {
                var child = property.GetValue(item); var childPath = path + "." + char.ToLowerInvariant(property.Name[0]) + property.Name[1..];
                if (child is null || child is string || child.GetType().IsValueType) continue;
                if (child is IEnumerable children) {
                    var i = 0;
                    foreach (var entry in children) {
                        if (entry is null) issues.Add(new("null_entry", $"{childPath}[{i}]", "Danh sách có phần tử trống", "Replace the null entry with a complete object."));
                        else if (entry is not string && !entry.GetType().IsValueType) Visit(entry, $"{childPath}[{i}]");
                        if (++i >= 100 || issues.Count >= 12) break;
                    }
                } else Visit(child, childPath);
            }
        }
        Visit(value, "$"); return issues.Take(12).ToList();
    }
}
