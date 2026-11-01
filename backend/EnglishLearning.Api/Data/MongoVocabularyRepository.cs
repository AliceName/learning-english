using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Documents;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;

namespace EnglishLearning.Api.Data;

public sealed class MongoVocabularyRepository(IMongoDatabase database, IOptions<MongoDbSettings> options,
    ILogger<MongoVocabularyRepository> logger) : IVocabularyRepository
{
    private readonly IMongoCollection<BsonDocument> collection = database.GetCollection<BsonDocument>(options.Value.VocabularyCollectionName);

    public async Task<VocabularyEntryDocument?> FindAsync(string key, CancellationToken cancellationToken)
    {
        using var deadline = Deadline(cancellationToken);
        var doc = await collection.Find(new BsonDocument("_id", key)).Limit(1).FirstOrDefaultAsync(deadline.Token);
        var entry = doc is null ? null : VocabularyEntryDocument.Read(doc, key);
        if (doc is not null && entry is null) logger.LogWarning("Invalid vocabulary document found; attempting source recovery.");
        return entry;
    }

    public async Task<VocabularyEntryDocument> SaveAsync(VocabularyEntryDocument entry, CancellationToken cancellationToken)
    {
        using var deadline = Deadline(cancellationToken);
        var filter = new BsonDocument("_id", entry.Id);
        var fields = entry.ToBson();
        fields.Remove("_id");
        try
        {
            var result = await collection.UpdateOneAsync(filter, new BsonDocument("$setOnInsert", fields),
                new UpdateOptions { IsUpsert = true }, deadline.Token);
            if (!result.IsAcknowledged) throw new InvalidOperationException("Vocabulary write was not acknowledged.");
            if (result.UpsertedId is not null) return entry; // No read after a confirmed insert.
        }
        catch (MongoWriteException error) when (error.WriteError.Category == ServerErrorCategory.DuplicateKey)
        { /* Another process inserted this key; return its persisted document. */ }

        for (var attempt = 0; attempt < 2; attempt++)
        {
            var existing = await collection.Find(filter).Limit(1).FirstOrDefaultAsync(deadline.Token);
            if (existing is null) throw new InvalidOperationException("Concurrent vocabulary entry disappeared.");
            var valid = VocabularyEntryDocument.Read(existing, entry.Id);
            if (valid is not null) return valid;
            // Compare the complete observed document; never replace a concurrent repair.
            var repaired = await collection.ReplaceOneAsync(existing, entry.ToBson(), cancellationToken: deadline.Token);
            if (repaired.IsAcknowledged && repaired.MatchedCount == 1) return entry;
        }
        throw new InvalidOperationException("Vocabulary repair conflicted with another writer.");
    }

    private CancellationTokenSource Deadline(CancellationToken token)
    {
        var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(options.Value.OperationTimeoutMs);
        return deadline;
    }
}
