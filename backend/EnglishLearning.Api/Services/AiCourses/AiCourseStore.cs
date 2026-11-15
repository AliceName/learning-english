using System.Text.Json;

namespace EnglishLearning.Api.Services.AiCourses;

// Single-host pilot store. OS file locks coordinate the API and worker, including restarts.
public sealed class AiCourseStore
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public string Root { get; }

    public AiCourseStore(IConfiguration configuration, IWebHostEnvironment environment)
    {
        Root = Path.GetFullPath(configuration["CourseGeneration:DataRoot"] ??
            Path.Combine(environment.ContentRootPath, "App_Data", "ai-courses"));
        foreach (var name in new[] { "jobs", "calls", "media-owners" })
            Directory.CreateDirectory(Path.Combine(Root, name));
    }

    public string JobDirectory(Guid id) => Path.Combine(Root, "jobs", id.ToString("N"));
    public string JobFile(Guid id) => Path.Combine(JobDirectory(id), "job.json");
    public string CallFile(Guid id) => Path.Combine(Root, "calls", id.ToString("N") + ".json");
    public string PolicyFile => Path.Combine(Root, "policy.json");

    public async Task<FileStream> LockAsync(CancellationToken ct)
    {
        while (true)
        {
            ct.ThrowIfCancellationRequested();
            try { return new FileStream(Path.Combine(Root, "store.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException) { await Task.Delay(50, ct); }
        }
    }

    public FileStream? TryWorkerLock()
    {
        try { return new FileStream(Path.Combine(Root, "worker.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
        catch (IOException) { return null; }
    }

    public T? Read<T>(string path) => File.Exists(path)
        ? JsonSerializer.Deserialize<T>(File.ReadAllText(path), Json) : default;

    public void Write<T>(string path, T value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(value, Json));
            File.Move(temporary, path, overwrite: true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    public AiCourseJob[] Jobs() => Directory.EnumerateFiles(Path.Combine(Root, "jobs"), "job.json", SearchOption.AllDirectories)
        .Select(Read<AiCourseJob>).OfType<AiCourseJob>().ToArray();

    public AiApiCall[] Calls() => Directory.EnumerateFiles(Path.Combine(Root, "calls"), "*.json")
        .Select(Read<AiApiCall>).OfType<AiApiCall>().ToArray();

    public async Task<AiCourseJob> RequireJobAsync(Guid id, int userId, CancellationToken ct)
    {
        using var gate = await LockAsync(ct);
        var job = Read<AiCourseJob>(JobFile(id));
        return job is not null && job.UserId == userId ? job
            : throw new AiCourseException(404, "generation_not_found", "Không tìm thấy lần tạo khóa học.");
    }

    public async Task SaveJobAsync(AiCourseJob job, CancellationToken ct)
    {
        using var gate = await LockAsync(ct);
        job.UpdatedAt = DateTimeOffset.UtcNow;
        Write(JobFile(job.Id), job);
    }

    public async Task RegisterPrivateMediaAsync(string fileName, int userId, CancellationToken ct)
    {
        using var gate = await LockAsync(ct);
        Write(Path.Combine(Root, "media-owners", fileName + ".json"), userId);
    }

    public int? PrivateMediaOwner(string fileName) =>
        Read<int?>(Path.Combine(Root, "media-owners", fileName + ".json"));
}
