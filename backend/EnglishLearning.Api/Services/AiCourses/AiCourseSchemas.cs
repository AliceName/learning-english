using System.Text.Json;
using System.Text.Json.Nodes;

namespace EnglishLearning.Api.Services.AiCourses;

// responseJsonSchema supports array/numeric bounds. String lengths and semantic
// rules remain application checks, so describe them instead of relying on ignored
// minLength/maxLength keywords.
internal static class AiCourseSchemas
{
    private static JsonObject Text(string description) => new() { ["type"] = "string", ["description"] = description };
    private static JsonObject Number(int min, int max) => new() { ["type"] = "integer", ["minimum"] = min, ["maximum"] = max };
    private static JsonObject Enum(params string[] values) => new() { ["type"] = "string", ["enum"] = new JsonArray(values.Select(value => (JsonNode?)JsonValue.Create(value)).ToArray()) };
    private static JsonObject Object(params (string Name, JsonNode Schema)[] fields) => new() {
        ["type"] = "object", ["additionalProperties"] = false,
        ["properties"] = new JsonObject(fields.Select(field => new KeyValuePair<string, JsonNode?>(field.Name, field.Schema))),
        ["required"] = new JsonArray(fields.Select(field => (JsonNode?)JsonValue.Create(field.Name)).ToArray())
    };
    private static JsonObject Array(JsonNode items, int min, int max) => new() { ["type"] = "array", ["items"] = items, ["minItems"] = min, ["maxItems"] = max };
    private static JsonElement Json(JsonNode node) => JsonSerializer.SerializeToElement(node);

    internal static JsonElement Outline(AiCourseConfig config) => Json(Object(
        ("summary", Text("Nonempty Vietnamese summary, at most 1500 characters.")),
        ("title", Text("Nonempty Vietnamese course title, at most 255 characters.")),
        ("description", Text("Nonempty Vietnamese description, at most 3000 characters.")),
        ("lessons", Array(Object(("title", Text("Nonempty title, at most 255 characters.")),
            ("objective", Text("Nonempty Vietnamese objective, at most 800 characters.")),
            ("skillType", Enum(config.Skills))), config.TotalLessons, config.TotalLessons))));

    private static JsonObject Questions(string skill, int count)
    {
        JsonObject Question(bool choice)
        {
            var fields = new List<(string Name, JsonNode Schema)> {
                ("type", Enum(choice ? "multiple_choice" : "fill_blank")),
                ("prompt", Text(choice ? "English question, 1-1000 characters." : "English question, 1-1000 characters, with exactly one literal [blank].")),
                ("options", Array(Text("Nonempty English option, at most 500 characters. All options must be distinct."), choice ? 2 : 0, choice ? 4 : 0)),
                ("correctOptionIndex", choice ? Number(0, 3) : new JsonObject { ["type"] = "null" }),
                ("answer", choice ? new JsonObject { ["type"] = "null" } : Text("One unambiguous answer, 1-500 characters, supported by the lesson.")),
                ("explanation", Text("Nonempty Vietnamese explanation justifying the answer, at most 1500 characters."))
            };
            if (skill == "reading") {
                fields.Add(("reference", Text("Copy a short EXACT contiguous quote from your own passage proving the answer, at most 1000 characters. No paraphrase, ellipsis or added quotation marks.")));
                fields.Add(("focus", Enum("skimming", "scanning", "inference", "vocabulary")));
            }
            return Object(fields.ToArray());
        }
        return Array(new JsonObject { ["anyOf"] = new JsonArray(Question(true), Question(false)) }, count, count);
    }

    internal static JsonElement Lesson(string skill, AiCourseConfig config) => Json(skill switch {
        "listening" => Object(("transcript", Text("Complete natural English transcript, no labels or vocal tags, at most 4000 characters.")), ("questions", Questions(skill, config.QuestionsPerLesson))),
        "speaking" => Object(("goals", Text("Nonempty Vietnamese goals, at most 3000 characters.")),
            ("sentences", Array(Object(("text", Text("Complete English sentence of 5-20 words, at most 300 characters. Write numbers as words; no IPA, URLs or non-English symbols."))), config.QuestionsPerLesson, config.QuestionsPerLesson))),
        "reading" => Object(("passageTitle", Text("Nonempty English title, at most 255 characters.")), ("category", Text("Category, at most 255 characters.")),
            ("passage", Text("English passage of 100-350 words, shorter for A1/A2.")), ("translation", Text("Nonempty faithful Vietnamese translation of the passage.")),
            ("instructions", Text("Vietnamese instructions, at most 3000 characters.")),
            ("vocabulary", Array(Object(("word", Text("English word, 1-100 characters.")), ("meaning", Text("Vietnamese meaning, 1-500 characters.")), ("example", Text("English example, at most 1000 characters."))), 3, 6)),
            ("questions", Questions(skill, config.QuestionsPerLesson))),
        "grammar" => Object(("topic", Text("Nonempty topic, at most 255 characters.")), ("rules", Text("Vietnamese rules with English examples, 500-3000 characters.")),
            ("commonMistakes", Text("Vietnamese explanation of common mistakes, at most 3000 characters.")), ("questions", Questions(skill, config.QuestionsPerLesson))),
        "writing" => Object(("taskType", Enum("paragraph", "email", "essay", "report", "proposal")), ("topic", Text("Nonempty topic, at most 255 characters.")),
            ("prompt", Text("Nonempty English writing prompt, at most 10000 characters.")), ("instructions", Text("Nonempty Vietnamese instructions, at most 5000 characters.")),
            ("minWords", Number(1, 5000)), ("maxWords", Number(1, 5000)), ("sampleAnswer", Text("English sample answer within minWords and maxWords. minWords must not exceed maxWords.")),
            ("rubric", Array(Object(("name", Text("Nonempty criterion name, at most 100 characters.")), ("description", Text("Vietnamese description, at most 2000 characters.")), ("weight", Number(25, 25))), 4, 4))),
        _ => throw new InvalidOperationException("Unknown lesson skill.")
    });
}
