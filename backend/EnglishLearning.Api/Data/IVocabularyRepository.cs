using EnglishLearning.Api.Documents;

namespace EnglishLearning.Api.Data;

public interface IVocabularyRepository
{
    Task<VocabularyEntryDocument?> FindAsync(string key, CancellationToken cancellationToken);
    Task<VocabularyEntryDocument> SaveAsync(VocabularyEntryDocument entry, CancellationToken cancellationToken);
}
