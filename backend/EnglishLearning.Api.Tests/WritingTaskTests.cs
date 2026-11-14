using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;

namespace EnglishLearning.Api.Tests;

internal sealed class TaskCatalogueFixture : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"writing-tasks-{Guid.NewGuid()}.json");
    public WritingTaskSnapshot Task { get; }
    public TaskCatalogueFixture()
    {
        var t = new WritingTaskSnapshot(Guid.NewGuid().ToString(), new string('a',64), "Synthetic task", new string('x',510) + " ’ 😀",
            "Beginner", "An email", "Synthetic topic", 25,25,"minimum", ["Choose TWO of the FOUR ideas; not all four."],
            new string('a',64),new string('b',64),"automated-reviewed-not-expert");
        Task = t with { Version = WritingTaskLibrary.Version(t) }; Write(Task);
    }
    public void Write(WritingTaskSnapshot task) => File.WriteAllText(Path, JsonSerializer.Serialize(
        new WritingTaskCatalogue([task], new string('a',64), 50), new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    public void Dispose() => File.Delete(Path);
}

public sealed class WritingTaskValidationTests
{
    private sealed class Environment : IWebHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Development";
        public string ApplicationName { get; set; } = "Tests";
        public string WebRootPath { get; set; } = "";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
    [Fact]
    public void Catalogue_preserves_full_prompt_and_rejects_changed_content_or_production()
    {
        using var f = new TaskCatalogueFixture();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["WritingTasks:CataloguePath"]=f.Path }).Build();
        var env = new Environment(); var library = new WritingTaskLibrary(config, env);
        var loaded = Assert.Single(library.Load().Items);
        Assert.Equal(f.Task.Prompt, loaded.Prompt); Assert.Equal(f.Task.Version, loaded.Version);
        Assert.Equal(f.Task.Requirements, loaded.Requirements);
        f.Write(f.Task with { Prompt = "Changed without updating hash" });
        Assert.Throws<InvalidDataException>(() => library.Load());
        env.EnvironmentName = "Production";
        Assert.Throws<InvalidOperationException>(() => library.Load());
    }
    [Fact]
    public void Catalogue_rejects_invalid_ranges_missing_checklist_and_wrong_level()
    {
        using var f = new TaskCatalogueFixture();
        Assert.False(WritingTaskLibrary.Valid(f.Task with { MaxWords = 1 }));
        Assert.False(WritingTaskLibrary.Valid(f.Task with { Requirements = [] }));
        Assert.False(WritingTaskLibrary.Valid(f.Task with { Level = "A2 certified" }));
        Assert.False(WritingTaskLibrary.Valid(null));
    }
}

public sealed partial class RegistrationSqlServerTests
{
    private sealed class TaskWritingHandler : HttpMessageHandler
    {
        public int Calls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) {
                Content=JsonContent.Create(new WritingAnalysis("B1",null,[],[])) });
        }
    }

    [SqlServerFact]
    public async Task Writing_sql_persists_version_and_replays_the_submission_key()
    {
        var owner = await SignIn(await RegisterLoginUser());
        await using var writingFactory = factory.WithWebHostBuilder(builder => builder.ConfigureServices(
            services => services.AddHttpClient<WritingAiClient>().ConfigurePrimaryHttpMessageHandler(() => new TaskWritingHandler())));
        using var client = writingFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", owner.AccessToken);
        const string path = "/api/v1/writing/submissions";
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/api/v1/auth/me",
            new { fullName = "Learner", targetLevel = "B1" })).StatusCode);
        using var initial = await client.PostAsJsonAsync(path, new { originalText = "First text." });
        Assert.Equal(HttpStatusCode.Created, initial.StatusCode);
        var root = (await initial.Content.ReadFromJsonAsync<WritingSubmissionResponse>())!;
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/api/v1/auth/me",
            new { fullName = "Learner", targetLevel = "C1" })).StatusCode);
        var request = new { parentSubmissionId = root.SubmissionId, originalText = "Second text.", requestId = Guid.NewGuid() };
        using var created = await client.PostAsJsonAsync(path, request);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var version = (await created.Content.ReadFromJsonAsync<WritingSubmissionResponse>())!;
        using var retry = await client.PostAsJsonAsync(path, request);
        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        Assert.Equal(version.SubmissionId, (await retry.Content.ReadFromJsonAsync<WritingSubmissionResponse>())!.SubmissionId);
        var history = (await client.GetFromJsonAsync<WritingHistory>(path + $"?practiceRootId={root.SubmissionId}"))!;
        Assert.Equal(new int?[] { 2, 1 }, history.Items.Select(item => item.VersionNumber));
        Assert.Equal(new[] { "C1", "B1" }, history.Items.Select(item => item.TargetCefr));
        Assert.Equal(1, history.Items[0].ParentVersionNumber);
    }

    [SqlServerFact]
    public async Task Task_revision_uses_server_snapshot_survives_missing_catalogue_and_groups_owned_history()
    {
        using var f = new TaskCatalogueFixture(); var handler = new TaskWritingHandler();
        await using var taskFactory = factory.WithWebHostBuilder(builder => builder
            .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string,string?> { ["WritingTasks:CataloguePath"]=f.Path }))
            .ConfigureServices(s => s.AddHttpClient<WritingAiClient>().ConfigurePrimaryHttpMessageHandler(() => handler)));
        using var c = taskFactory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/v1/writing/tasks")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/v1/writing/practices")).StatusCode);
        var owner = await SignIn(await RegisterLoginUser()); var other = await SignIn(await RegisterLoginUser());
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",owner.AccessToken);
        async Task<WritingSubmissionResponse> Submit(object body)
        {
            var response=await c.PostAsJsonAsync("/api/v1/writing/submissions", body);
            Assert.Equal(HttpStatusCode.Created,response.StatusCode);
            return (await response.Content.ReadFromJsonAsync<WritingSubmissionResponse>())!;
        }
        var first=await Submit(new { taskId=f.Task.Id, taskVersion=f.Task.Version, originalText="Synthetic original sentence.", corrections=false });
        Assert.Equal(f.Task.Prompt, first.Task!.Prompt); Assert.Equal("Synthetic task",first.Topic);
        Assert.Equal(first.SubmissionId, first.PracticeRootId); Assert.Null(first.ParentSubmissionId);
        Assert.Equal(1, first.VersionNumber);
        var separate=await Submit(new { taskId=f.Task.Id, taskVersion=f.Task.Version, originalText="New independent attempt.", corrections=false });
        Assert.Equal(separate.SubmissionId,separate.PracticeRootId);
        File.Delete(f.Path);
        var revision=await Submit(new { parentSubmissionId=first.SubmissionId, originalText="Revised text.", corrections=false });
        Assert.Equal(f.Task.Prompt,revision.Task!.Prompt); Assert.Equal(first.SubmissionId,revision.PracticeRootId);
        Assert.Equal(first.SubmissionId,revision.ParentSubmissionId);
        Assert.Equal(2, revision.VersionNumber);
        Assert.Equal(1, revision.ParentVersionNumber);
        var restored=await c.GetFromJsonAsync<WritingSubmissionResponse>($"/api/v1/writing/submissions/{revision.SubmissionId}");
        Assert.Equal(f.Task.Prompt,restored!.Task!.Prompt);
        var groups=(await c.GetFromJsonAsync<WritingPractices>("/api/v1/writing/practices?limit=1"))!;
        Assert.Equal(first.SubmissionId,Assert.Single(groups.Items).PracticeRootId); Assert.Equal(2,groups.Items[0].SubmissionCount);
        Assert.Equal(revision.SubmissionId,groups.NextBeforeId);
        var next=(await c.GetFromJsonAsync<WritingPractices>($"/api/v1/writing/practices?limit=1&beforeId={groups.NextBeforeId}"))!;
        Assert.Equal(separate.SubmissionId,Assert.Single(next.Items).PracticeRootId); Assert.Null(next.NextBeforeId);
        var versions=(await c.GetFromJsonAsync<WritingHistory>($"/api/v1/writing/submissions?limit=1&practiceRootId={first.SubmissionId}"))!;
        Assert.Equal(revision.SubmissionId,Assert.Single(versions.Items).SubmissionId);
        var old=(await c.GetFromJsonAsync<WritingHistory>($"/api/v1/writing/submissions?limit=1&practiceRootId={first.SubmissionId}&beforeId={versions.NextBeforeId}"))!;
        Assert.Equal(first.SubmissionId,Assert.Single(old.Items).SubmissionId); Assert.Null(old.NextBeforeId);
        Assert.Equal(1, old.Items[0].VersionNumber);
        var legacy=await Submit(new { topic="Legacy custom topic", originalText="Custom text.",corrections=false });
        Assert.Null(legacy.Task);
        var legacyRevision=await Submit(new { parentSubmissionId=legacy.SubmissionId, originalText="Custom revision.",corrections=false });
        Assert.Equal(legacy.Topic,legacyRevision.Topic); Assert.Equal(legacy.SubmissionId,legacyRevision.PracticeRootId);
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",other.AccessToken);
        var calls=handler.Calls;
        Assert.Equal(HttpStatusCode.NotFound,(await c.PostAsJsonAsync("/api/v1/writing/submissions",new { parentSubmissionId=first.SubmissionId,originalText="Wrong owner",corrections=false })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await c.GetAsync($"/api/v1/writing/submissions?practiceRootId={first.SubmissionId}")).StatusCode);
        Assert.Empty((await c.GetFromJsonAsync<WritingPractices>("/api/v1/writing/practices"))!.Items);
        Assert.Equal(calls,handler.Calls);
    }

    [SqlServerFact]
    public async Task Invalid_task_hash_spoofed_snapshot_and_changed_topic_are_rejected_before_AI()
    {
        using var f=new TaskCatalogueFixture(); var handler=new TaskWritingHandler();
        await using var taskFactory=factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_,config) =>
            config.AddInMemoryCollection(new Dictionary<string,string?> { ["WritingTasks:CataloguePath"]=f.Path }))
            .ConfigureServices(s => s.AddHttpClient<WritingAiClient>().ConfigurePrimaryHttpMessageHandler(() => handler)));
        using var c=taskFactory.CreateClient(); var owner=await SignIn(await RegisterLoginUser());
        c.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",owner.AccessToken);
        Assert.Equal(HttpStatusCode.Conflict,(await c.PostAsJsonAsync("/api/v1/writing/submissions",new { taskId=f.Task.Id,taskVersion=new string('0',64),originalText="Text",corrections=false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await c.PostAsJsonAsync("/api/v1/writing/submissions",new { taskId=Guid.NewGuid().ToString(),taskVersion=f.Task.Version,originalText="Text",corrections=false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await c.PostAsJsonAsync("/api/v1/writing/submissions",new { task=f.Task,originalText="Text",corrections=false })).StatusCode);
        Assert.Equal(0,handler.Calls);
        var first=await (await c.PostAsJsonAsync("/api/v1/writing/submissions",new { topic="Original topic",originalText="Text",corrections=false })).Content.ReadFromJsonAsync<WritingSubmissionResponse>();
        Assert.Equal(HttpStatusCode.BadRequest,(await c.PostAsJsonAsync("/api/v1/writing/submissions",new { parentSubmissionId=first!.SubmissionId,topic="Changed topic",originalText="Text",corrections=false })).StatusCode);
        Assert.Equal(1,handler.Calls);
    }
}
