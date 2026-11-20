using System.IO.Compression;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using UglyToad.PdfPig;
using UglyToad.PdfPig.DocumentLayoutAnalysis.TextExtractor;

namespace EnglishLearning.Api.Services.AiCourses;

public static class AiCourseSource
{
    public const int MaxBytes = 10 * 1024 * 1024;
    public static string Extract(byte[] bytes, string extension, CancellationToken ct)
    {
        try
        {
            var text = new StringBuilder();
            var sourceCharacters = 0;
            if (extension == "pdf")
            {
                if (!bytes.AsSpan().StartsWith("%PDF-"u8)) throw new InvalidDataException();
                using var document = PdfDocument.Open(bytes);
                if (document.NumberOfPages > 30)
                    throw new AiCourseException(413, "too_many_pages", "PDF tối đa 30 trang.");
                foreach (var page in document.GetPages())
                {
                    ct.ThrowIfCancellationRequested();
                    var value = ContentOrderTextExtractor.GetText(page).Trim();
                    sourceCharacters += value.Length;
                    if (value.Length > 0) text.AppendLine($"[Trang {page.Number}]").AppendLine(value);
                    CheckLength(text.Length);
                }
            }
            else
            {
                using var input = new MemoryStream(bytes);
                using var zip = new ZipArchive(input, ZipArchiveMode.Read);
                var entry = zip.GetEntry("word/document.xml");
                if (entry is null || entry.Length > 4 * 1024 * 1024) throw new InvalidDataException();
                using var part = entry.Open();
                using var xml = XmlReader.Create(part, new XmlReaderSettings {
                    DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 4 * 1024 * 1024
                });
                var document = XDocument.Load(xml);
                XNamespace word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
                var index = 0;
                foreach (var paragraph in document.Descendants(word + "p"))
                {
                    ct.ThrowIfCancellationRequested();
                    var value = string.Concat(paragraph.Descendants().Select(node =>
                        node.Name == word + "t" ? node.Value : node.Name == word + "br" ? "\n" : ""));
                    sourceCharacters += value.Trim().Length;
                    if (!string.IsNullOrWhiteSpace(value)) text.AppendLine($"[Đoạn {++index}] {value}");
                    CheckLength(text.Length);
                }
            }
            var result = text.ToString().Trim();
            if (sourceCharacters < 100)
                throw new AiCourseException(400, "source_too_short", "Tài liệu cần có ít nhất 100 ký tự văn bản có thể đọc. Với PDF scan, hãy dùng bản có thể chọn chữ.");
            return result;
        }
        catch (Exception error) when (error is not AiCourseException and not OperationCanceledException)
        {
            throw new AiCourseException(400, "document_unreadable", "Không đọc được tài liệu. Hãy chọn PDF có văn bản hoặc DOCX hợp lệ.");
        }
    }

    private static void CheckLength(int length)
    {
        if (length > 50_000) throw new AiCourseException(413, "source_too_long", "Văn bản trích xuất tối đa 50.000 ký tự. Hãy chia tài liệu.");
    }
}
