using System.IO.Compression;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

namespace EnglishLearning.Api.Services;

public sealed record ImportedQuestion(string Type, string Prompt, string[] Options, int? CorrectOptionIndex,
    string? Answer, string? Explanation);

public sealed record QuestionImportSource(int QuestionNumber, int ParagraphIndex, string Excerpt, string[] TableAnswers);
public sealed record QuestionImportItem(ImportedQuestion? Question, QuestionImportSource Source, string Status, string[] Issues);
public sealed record QuestionImportPreview(QuestionImportItem[] Questions, string[] Warnings);

public static class QuestionDocxImport
{
    public const int MaxFileBytes = 2 * 1024 * 1024;
    public const int MaxRequestBytes = MaxFileBytes + 64 * 1024;
    private const int MaxDocumentBytes = 4 * 1024 * 1024;
    private const int MaxTextChars = 150_000;
    private const int MaxQuestions = 100;
    private static readonly Regex QuestionStart = new(@"^(?:Câu|Question)\s+([1-9][0-9]{0,5})\s*[.:]\s*(.*)$", RegexOptions.IgnoreCase);
    private static readonly Regex OptionStart = new(@"^([A-Z])[.)]\s*(.*)$");
    private static readonly Regex AnswerStart = new(@"^(?:Đáp án|Answer)\s*:\s*(.*)$", RegexOptions.IgnoreCase);
    private static readonly Regex ExplanationStart = new(@"^(?:Giải thích|Lời giải|Explanation)\s*:\s*(.*)$", RegexOptions.IgnoreCase);
    private static readonly Regex ChoiceAnswer = new(@"^([A-D])[.)]?$", RegexOptions.IgnoreCase);
    private static readonly HashSet<string> UnsupportedElements = [
        "drawing", "pict", "object", "oMath", "oMathPara", "altChunk", "fldSimple", "instrText", "sym", "del", "moveFrom"
    ];

    public static QuestionImportPreview Read(Stream stream, CancellationToken ct)
    {
        try
        {
            using var archive = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true);
            var entry = archive.GetEntry("word/document.xml");
            if (entry is null || archive.GetEntry("[Content_Types].xml") is null)
                throw new InvalidDataException();
            if (entry.Length > MaxDocumentBytes)
                throw new AuthoringException(413, "Nội dung Word sau giải nén vượt giới hạn.");

            using var documentStream = entry.Open();
            using var xml = XmlReader.Create(documentStream, new XmlReaderSettings {
                DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = MaxDocumentBytes
            });
            var root = XDocument.Load(xml).Root;
            var word = root?.Name.Namespace;
            if (root?.Name.LocalName != "document" || word is null ||
                word.NamespaceName is not ("http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                    or "http://purl.oclc.org/ooxml/wordprocessingml/main") || root.Element(word + "body") is not { } body)
                throw new InvalidDataException();

            return ReadBody(body, word, ct);
        }
        catch (Exception error) when (error is InvalidDataException or XmlException or IOException)
        {
            throw new AuthoringException(400, "Không đọc được tệp Word. Hãy chọn tệp DOCX theo mẫu.");
        }
    }

    private static QuestionImportPreview ReadBody(XElement body, XNamespace word, CancellationToken ct)
    {
        var drafts = new List<Draft>();
        var tableAnswers = new Dictionary<int, List<string>>();
        var warnings = new List<string>();
        var paragraphIndex = 0;
        var textChars = 0;
        var malformedAnswerTable = false;
        Draft? current = null;
        foreach (var element in body.Elements())
        {
            ct.ThrowIfCancellationRequested();
            if (element.Name == word + "tbl")
            {
                var rows = element.Elements(word + "tr").Select(row => row.Elements(word + "tc")
                    .Select(cell => string.Join("\n", cell.Elements(word + "p").Select(p => ParagraphText(p, word))).Trim())
                    .ToArray()).ToArray();
                textChars += rows.SelectMany(row => row).Sum(cell => cell.Length);
                if (rows.FirstOrDefault()?.FirstOrDefault()?.Equals("Câu", StringComparison.OrdinalIgnoreCase) == true)
                {
                    if (HasUnsupportedContent(element) || element.Descendants().Any(node => node.Name.LocalName is "tbl" or "vMerge" or "hMerge" or "gridSpan")
                        || !ReadAnswerTable(rows, tableAnswers))
                        malformedAnswerTable = true;
                }
                else
                {
                    if (current is not null) current.Unsupported = true;
                    const string warning = "Có bảng ngoài mẫu đáp án. Hãy đối chiếu với tệp gốc.";
                    if (!warnings.Contains(warning)) warnings.Add(warning);
                }
                current = null;
                CheckTextSize(textChars);
                continue;
            }
            if (element.Name == word + "sectPr") continue;
            if (element.Name != word + "p")
            {
                if (current is not null) current.Unsupported = true;
                continue;
            }

            paragraphIndex++;
            var unsupported = HasUnsupportedContent(element);
            var paragraph = ParagraphText(element, word);
            textChars += paragraph.Length;
            CheckTextSize(textChars);
            foreach (var rawLine in paragraph.Split('\n'))
            {
                var line = rawLine.Trim();
                var start = QuestionStart.Match(line);
                if (start.Success)
                {
                    if (drafts.Count == MaxQuestions)
                        throw new AuthoringException(400, $"Tệp vượt {MaxQuestions} câu. Hãy chia đề thành nhiều tệp.");
                    current = new Draft(int.Parse(start.Groups[1].Value), paragraphIndex, start.Groups[2].Value);
                    drafts.Add(current);
                }
                else if (line.Equals("HẾT", StringComparison.OrdinalIgnoreCase))
                {
                    current = null;
                    continue;
                }
                else if (current is not null && line.Length > 0) current.AddLine(line);

                if (current is null) continue;
                current.Unsupported |= unsupported;
                if (line.Length > 0) current.SourceLines.Add(line);
            }
        }

        if (drafts.Count == 0)
            throw new AuthoringException(400, "Không tìm thấy câu hỏi. Ghi số câu theo mẫu “Câu 1.” hoặc “Question 1.”.");
        if (malformedAnswerTable) warnings.Add("Bảng đáp án sai mẫu. Hãy xác nhận lại đáp án trắc nghiệm.");
        var duplicateNumbers = drafts.GroupBy(draft => draft.Number).Where(group => group.Count() > 1)
            .Select(group => group.Key).ToHashSet();
        if (tableAnswers.Keys.Except(drafts.Select(draft => draft.Number)).Any())
            warnings.Add("Bảng đáp án có số câu không tìm thấy trong đề.");

        return new(drafts.Select(draft => draft.ToItem(tableAnswers.GetValueOrDefault(draft.Number) ?? [],
            duplicateNumbers.Contains(draft.Number), malformedAnswerTable)).ToArray(), warnings.ToArray());
    }

    private static string ParagraphText(XElement element, XNamespace word) =>
        string.Concat(element.Descendants().Select(node => node.Name == word + "t" ? node.Value
            : node.Name == word + "tab" ? "\t" : node.Name == word + "br" || node.Name == word + "cr" ? "\n" : ""));

    private static bool HasUnsupportedContent(XElement element) =>
        element.Descendants().Any(node => UnsupportedElements.Contains(node.Name.LocalName));

    private static void CheckTextSize(int textChars)
    {
        if (textChars > MaxTextChars)
            throw new AuthoringException(413, "Văn bản trong tệp quá dài. Hãy chia đề thành nhiều tệp.");
    }

    private static bool ReadAnswerTable(string[][] rows, Dictionary<int, List<string>> answers)
    {
        if (rows.Length != 2 || rows[0].Length < 2 || rows[0].Length != rows[1].Length ||
            !rows[1][0].Equals("Chọn", StringComparison.OrdinalIgnoreCase)) return false;
        var values = new List<(int Number, string Answer)>();
        for (var i = 1; i < rows[0].Length; i++)
        {
            if (!int.TryParse(rows[0][i], out var number) || number <= 0) return false;
            values.Add((number, rows[1][i]));
        }
        foreach (var (number, answer) in values)
        {
            if (!answers.TryGetValue(number, out var list)) answers[number] = list = [];
            list.Add(answer);
        }
        return true;
    }

    private sealed class Draft(int number, int paragraphIndex, string prompt)
    {
        private readonly List<(char Label, string Text)> options = [];
        private readonly List<string> answers = [];
        private readonly List<string> promptLines = [prompt];
        private readonly List<string> explanationLines = [];
        public int Number { get; } = number;
        public List<string> SourceLines { get; } = [];
        public bool Unsupported { get; set; }

        public void AddLine(string line)
        {
            var match = OptionStart.Match(line);
            if (match.Success)
            {
                options.Add((match.Groups[1].Value[0], match.Groups[2].Value));
                return;
            }
            match = AnswerStart.Match(line);
            if (match.Success)
            {
                answers.Add(match.Groups[1].Value);
                return;
            }
            match = ExplanationStart.Match(line);
            if (match.Success)
            {
                explanationLines.Add(match.Groups[1].Value);
                return;
            }
            if (explanationLines.Count > 0) explanationLines.Add(line);
            else if (options.Count == 0 && answers.Count == 0) promptLines.Add(line);
            else Unsupported = true;
        }

        public QuestionImportItem ToItem(List<string> table, bool duplicateNumber, bool malformedTable)
        {
            var excerpt = string.Join("\n", SourceLines);
            var source = new QuestionImportSource(Number, paragraphIndex,
                excerpt.Length <= 1600 ? excerpt : excerpt[..1600] + "…", table.Take(4).Select(value => value.Length <= 100 ? value : value[..100] + "…").ToArray());
            var multipleChoice = options.Count > 0;
            var questionPrompt = string.Join("\n", promptLines).Trim();
            if (Unsupported || (!multipleChoice && questionPrompt.Split("[blank]", StringSplitOptions.None).Length != 2) ||
                options.Count > 4 || options.Any(option => option.Label is < 'A' or > 'D'))
                return new(null, source, "unsupported", ["Câu có nội dung hoặc dạng nằm ngoài mẫu Word."]);

            var issues = new List<string>();
            if (duplicateNumber) issues.Add("Số câu bị trùng. Hãy kiểm tra câu gốc và đáp án.");
            var explanation = explanationLines.Count == 0 ? null : string.Join("\n", explanationLines).Trim();
            if (questionPrompt.Length is 0 or > 2000) issues.Add("Nội dung câu hỏi cần từ 1 đến 2.000 ký tự.");
            if (explanation?.Length > 2000) issues.Add("Giải thích dài quá 2.000 ký tự.");

            string? answer = null;
            int? correct = null;
            var choices = options.Select(option => option.Text.Trim()).ToArray();
            if (multipleChoice)
            {
                var orderedLabels = options.Select(option => option.Label).SequenceEqual(Enumerable.Range('A', options.Count).Select(code => (char)code));
                if (!orderedLabels) issues.Add("Ký hiệu lựa chọn cần theo thứ tự A, B, C, D.");
                if (choices.Length < 2 || choices.Any(value => value.Length is 0 or > 500) ||
                    choices.Distinct(StringComparer.OrdinalIgnoreCase).Count() != choices.Length)
                    issues.Add("Cần 2–4 lựa chọn khác nhau, mỗi lựa chọn tối đa 500 ký tự.");
                var keys = (duplicateNumber ? answers.AsEnumerable() : answers.Concat(table))
                    .Where(value => !string.IsNullOrWhiteSpace(value)).Select(value =>
                        ChoiceAnswer.Match(value.Trim()).Groups[1].Value.ToUpperInvariant()).Distinct().ToArray();
                if (malformedTable) issues.Add("Hãy xác nhận lại đáp án do bảng cuối đề sai mẫu.");
                else if (keys.Length == 0) issues.Add("Thiếu đáp án.");
                else if (keys.Length != 1) issues.Add("Các đáp án trong nguồn mâu thuẫn.");
                else if (!orderedLabels || keys[0].Length != 1 || options.FindIndex(item => item.Label == keys[0][0]) is not (>= 0 and var index))
                    issues.Add("Đáp án không khớp các lựa chọn.");
                else correct = index;
            }
            else
            {
                var keys = answers.Select(value => value.Trim()).Where(value => value.Length > 0).Distinct(StringComparer.Ordinal).ToArray();
                if (keys.Length == 0) issues.Add("Thiếu đáp án.");
                else if (keys.Length > 1) issues.Add("Các đáp án trong nguồn mâu thuẫn.");
                else if (keys[0].Length > 500) issues.Add("Đáp án dài quá 500 ký tự.");
                else answer = keys[0];
            }
            return new(new(multipleChoice ? "multiple_choice" : "fill_blank", questionPrompt, choices, correct, answer, explanation),
                source, issues.Count == 0 ? "ready" : "review", issues.ToArray());
        }
    }
}
