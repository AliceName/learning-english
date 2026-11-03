using System.Reflection;
using MongoDB.Bson;
using MongoDB.Driver;

namespace EnglishLearning.Api.Data;

public static class MongoVocabularySchema
{
    public static BsonDocument Validator()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("EnglishLearning.Api.Resources.Vocabulary.schema.json")!;
        using var reader = new StreamReader(stream);
        return new("$jsonSchema", BsonDocument.Parse(reader.ReadToEnd()));
    }

    // Explicit provisioning only. Startup never creates collections or changes validators.
    public static async Task InitializeAsync(IMongoDatabase database, string collectionName, CancellationToken token)
    {
        var validator = Validator();
        using var names = await database.ListCollectionNamesAsync(new ListCollectionNamesOptions
            { Filter = new BsonDocument("name", collectionName) }, token);
        if (!(await names.ToListAsync(token)).Contains(collectionName))
        {
            await database.CreateCollectionAsync(collectionName, new CreateCollectionOptions<BsonDocument>
            {
                Validator = validator, ValidationLevel = DocumentValidationLevel.Strict,
                ValidationAction = DocumentValidationAction.Error
            }, token);
            return;
        }
        var invalid = await database.GetCollection<BsonDocument>(collectionName)
            .Find(new BsonDocument("$nor", new BsonArray { validator })).Limit(1).AnyAsync(token);
        if (invalid) throw new InvalidOperationException("Existing vocabulary data violates the proposed validator. Review it before updating the collection; no data was changed.");
        await database.RunCommandAsync<BsonDocument>(new BsonDocument
        {
            { "collMod", collectionName }, { "validator", validator },
            { "validationLevel", "strict" }, { "validationAction", "error" }
        }, cancellationToken: token);
    }
}
