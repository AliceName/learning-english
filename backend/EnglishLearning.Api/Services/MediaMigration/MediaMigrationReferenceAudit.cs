using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using Microsoft.Data.SqlClient;
using MongoDB.Bson;
using MongoDB.Driver;

namespace EnglishLearning.Api.Services.MediaMigration;

public sealed class MediaMigrationReferenceAudit(IConfiguration configuration) : IMediaMigrationReferenceAudit
{
    public async Task<MigrationAudit> ReadAsync(CancellationToken token)
    {
        var references = new List<MigrationReference>(); var issues = new List<MigrationIssue>();
        using var fingerprint = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        void Hash(string value) { fingerprint.AppendData(Encoding.UTF8.GetBytes(value)); fingerprint.AppendData([0]); }
        void Url(string? value, string location, string? type)
        {
            if (value is null) return;
            try { references.AddRange(ManagedReferences(value, location, type)); }
            catch (MediaMigrationException) { issues.Add(new("invalid_managed_reference", Location: location)); }
        }
        void Content(JsonElement element, string location)
        {
            if (element.ValueKind == JsonValueKind.String) Url(element.GetString(), location, null);
            else if (element.ValueKind == JsonValueKind.Object) foreach (var property in element.EnumerateObject()) Content(property.Value, location + "." + property.Name);
            else if (element.ValueKind == JsonValueKind.Array) { var index = 0; foreach (var value in element.EnumerateArray()) Content(value, location + "[" + index++ + "]"); }
        }
        var complete = true;
        try
        {
            var connectionString = configuration.GetConnectionString("DefaultConnection");
            if (string.IsNullOrWhiteSpace(connectionString)) throw new InvalidOperationException();
            await using var connection = new SqlConnection(connectionString); await connection.OpenAsync(token);
            await using var command = connection.CreateCommand(); command.CommandTimeout = 20;
            command.CommandText = "SELECT CourseId, CoverImageUrl FROM Courses ORDER BY CourseId; SELECT LessonId, AudioUrl, Content FROM Lessons ORDER BY LessonId;";
            await using var reader = await command.ExecuteReaderAsync(token);
            while (await reader.ReadAsync(token))
            {
                var id = reader.GetInt32(0); var value = reader.IsDBNull(1) ? null : reader.GetString(1);
                Hash(JsonSerializer.Serialize(new { table = "Courses", id, value })); Url(value, $"Courses[{id}].CoverImageUrl", "image/");
            }
            await reader.NextResultAsync(token);
            while (await reader.ReadAsync(token))
            {
                var id = reader.GetInt32(0); var audio = reader.IsDBNull(1) ? null : reader.GetString(1); var content = reader.IsDBNull(2) ? null : reader.GetString(2);
                Hash(JsonSerializer.Serialize(new { table = "Lessons", id, audio, content })); Url(audio, $"Lessons[{id}].AudioUrl", "audio/");
                if (content is null) continue;
                try { using var json = JsonDocument.Parse(content, new JsonDocumentOptions { MaxDepth = 32 }); Content(json.RootElement, $"Lessons[{id}].Content"); }
                catch (JsonException) { issues.Add(new("invalid_lesson_content_preserved", Location: $"Lessons[{id}].Content")); }
            }
        }
        catch (Exception error) when (!token.IsCancellationRequested && error is SqlException or InvalidOperationException or TimeoutException)
        { complete = false; issues.Add(new("sql_reference_audit_unavailable")); }
        try
        {
            var settings = configuration.GetSection(MongoDbSettings.SectionName).Get<MongoDbSettings>() ?? new();
            if (string.IsNullOrWhiteSpace(settings.ConnectionString)) throw new InvalidOperationException();
            var clientSettings = MongoClientSettings.FromConnectionString(settings.ConnectionString); clientSettings.ServerSelectionTimeout = TimeSpan.FromSeconds(5);
            var collection = new MongoClient(clientSettings).GetDatabase(settings.DatabaseName).GetCollection<BsonDocument>(settings.VocabularyCollectionName);
            using var cursor = await collection.Find(FilterDefinition<BsonDocument>.Empty).Sort(Builders<BsonDocument>.Sort.Ascending("_id"))
                .Project(Builders<BsonDocument>.Projection.Include("_id").Include("entries.phonetics")).ToCursorAsync(token);
            while (await cursor.MoveNextAsync(token)) foreach (var document in cursor.Current)
            {
                Hash(document.ToJson());
                if (references.Count > 100000) throw new MediaMigrationException("reference_limit_exceeded");
                if (!document.TryGetValue("entries", out var entries) || !entries.IsBsonArray) continue;
                var entryIndex = 0;
                foreach (var value in entries.AsBsonArray)
                {
                    if (value.IsBsonDocument && value.AsBsonDocument.TryGetValue("phonetics", out var phonetics) && phonetics.IsBsonArray)
                    {
                        var phoneticIndex = 0;
                        foreach (var phonetic in phonetics.AsBsonArray)
                        {
                            if (phonetic.IsBsonDocument)
                            {
                                var item = phonetic.AsBsonDocument;
                                string? Text(string key) => item.TryGetValue(key, out var field) && field.IsString ? field.AsString : null;
                                var reference = WikimediaAudioResolver.Identify(new DictionaryPhonetic(null, Text("audio"), Text("sourceUrl"), null));
                                if (reference is not null) references.Add(new($"Vocabulary[{document["_id"]}].entries[{entryIndex}].phonetics[{phoneticIndex}]", DictionaryKey: reference.Key));
                            }
                            phoneticIndex++;
                        }
                    }
                    entryIndex++;
                }
            }
        }
        catch (Exception error) when (!token.IsCancellationRequested && error is MongoException or InvalidOperationException or ArgumentException or TimeoutException)
        { complete = false; issues.Add(new("mongo_reference_audit_unavailable")); }
        // Reports contain only managed names/locations and a hash of the read-only audit.
        // External URLs, lesson answers, connection strings and raw DB rows never leave this boundary.
        return new(complete, Convert.ToHexStringLower(fingerprint.GetHashAndReset()), references.OrderBy(reference => reference.Location, StringComparer.Ordinal).ToArray(), issues);
    }

    public static IReadOnlyList<MigrationReference> ManagedReferences(string value, string location, string? type)
    {
        if (value.StartsWith("/api/media/", StringComparison.Ordinal))
            return MediaStorage.IsManagedFileName(value[11..]) ? [new(location, value[11..], TypePrefix: type)] : throw new MediaMigrationException("invalid_managed_reference");
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https") return [];
        return Regex.Matches(value, @"(?<![A-Za-z0-9:/._-])/api/media/([a-f0-9]{32}\.(?:jpeg|jpg|png|webp|mp3|wav|aac|m4a))\b")
            .Select(match => new MigrationReference(location + ":text", match.Groups[1].Value)).ToArray();
    }
}
