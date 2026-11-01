namespace EnglishLearning.Api.Services;

public interface IMediaStorage
{
    Task<(string FileName, string ContentType, long SizeBytes)> SaveAsync(IFormFile file, string kind, CancellationToken token);
    Task<bool> ExistsAsync(string url, string typePrefix, CancellationToken token);
    Task<CourseMediaPlayback?> OpenAsync(string fileName, string? range, CancellationToken token);
}

public sealed record CourseMediaPlayback(Stream Body, string ContentType, long Length, int Status = 200,
    string? ContentRange = null, bool EnableRangeProcessing = false) : IAsyncDisposable
{
    public ValueTask DisposeAsync() => Body.DisposeAsync();
}
