using System.Net;
using System.Net.Http.Json;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed class BilingualHttpTests
{
    private sealed class Lookup : IBilingualVocabularyService
    {
        public Task<VocabularyResponse> LookupAsync(string word, string direction, CancellationToken token)
        {
            var response = BilingualFixture.Response();
            return Task.FromResult(response with { Word = word, Direction = direction, Language = VocabularyWord.Language(direction), DefinitionLanguage = VocabularyWord.DefinitionLanguage(direction) });
        }
    }

    [Fact]
    public async Task Normal_endpoints_require_auth_route_directions_and_prepare_and_stream_selected_audio()
    {
        var database = "bilingual-http-" + Guid.NewGuid().ToString("N");
        var root = Path.Combine(Path.GetTempPath(), "englishlearning-audio-tests-" + Guid.NewGuid().ToString("N"));
        var ttsCalls = 0;
        var upstream = new AudioTestFactory((request, _) =>
        {
            Assert.Equal("dict.minhqnd.com", request.RequestUri!.Host);
            Assert.Contains(Uri.EscapeDataString("Sách."), request.RequestUri.AbsoluteUri);
            Interlocked.Increment(ref ttsCalls);
            var content = new ByteArrayContent(BilingualFixture.Mp3()); content.Headers.ContentType = new("audio/mpeg");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = content });
        });
        try
        {
            await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Development")
                .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Jwt:SigningKey"] = TestJwt.SigningKey, ["ConnectionStrings:DefaultConnection"] = "test-only",
                    ["DefinitionAudioSettings:Enabled"] = "true", ["DictionaryAudioSettings:RootPath"] = root
                })).ConfigureServices(services =>
                {
                    services.RemoveAll<EnglishLearningDbContext>();
                    services.AddScoped(_ => new EnglishLearningDbContext(new DbContextOptionsBuilder<EnglishLearningDbContext>().UseInMemoryDatabase(database).Options));
                    services.RemoveAll<IBilingualVocabularyService>(); services.AddSingleton<IBilingualVocabularyService>(new Lookup());
                    services.RemoveAll<IHttpClientFactory>(); services.AddSingleton<IHttpClientFactory>(upstream);
                    services.RemoveAll<IVocabularyRepository>(); services.AddSingleton<IVocabularyRepository>(new MemoryVocabularyRepository());
                    services.RemoveAll<IDictionaryApiClient>(); services.AddSingleton<IDictionaryApiClient>(new FakeDictionaryClient());
                    services.RemoveAll<IDictionaryAudioStorage>(); services.AddSingleton<IDictionaryAudioStorage>(provider => new DictionaryAudioStorage(
                        provider.GetRequiredService<IOptions<DictionaryAudioSettings>>(), new AudioTestEnvironment()));
                }));
            using var client = factory.CreateClient();
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/vocabulary?word=book&direction=en-vi")).StatusCode);
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
                db.Users.Add(new User { UserId = 1, Email = "dictionary-test@example.com", FullName = "Test", PasswordHash = "test" });
                await db.SaveChangesAsync();
            }
            client.DefaultRequestHeaders.Authorization = new("Bearer", TestJwt.Create());
            var response = await client.GetAsync("/api/v1/vocabulary?word=book&direction=en-vi");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var result = (await response.Content.ReadFromJsonAsync<VocabularyResponse>())!;
            Assert.Equal("en-vi", result.Direction); Assert.Equal("minhqnd", result.Provider);
            Assert.Equal(0, ttsCalls);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/vocabulary?word=h%E1%BB%8Dc%20sinh&direction=vi-en")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/vocabulary?word=hello")).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/v1/vocabulary?word=hello&direction=invalid")).StatusCode);
            var selection = new DefinitionAudioRequest { Word = "book", DefinitionId = result.Entries[0].Meanings[0].Definitions[0].DefinitionId! };
            response = await client.PostAsJsonAsync("/api/v1/vocabulary/definition-audio/prepare", selection);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var ready = (await response.Content.ReadFromJsonAsync<DefinitionAudioReadyResponse>())!;
            Assert.True(ready.Attribution.Synthetic); Assert.Equal(1, ttsCalls);
            await client.PostAsJsonAsync("/api/v1/vocabulary/definition-audio/prepare", selection);
            Assert.Equal(1, ttsCalls);
            using var playback = new HttpRequestMessage(HttpMethod.Get, "/api/v1/vocabulary/definition-audio?key=" + ready.AudioKey);
            playback.Headers.Range = new(0, 99);
            response = await client.SendAsync(playback);
            Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
            Assert.Equal(100, (await response.Content.ReadAsByteArrayAsync()).Length);
            Assert.True(response.Headers.CacheControl!.NoStore);
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/v1/vocabulary/definition-audio?key=" + new string('a', 64))).StatusCode);
            Assert.Equal(1, ttsCalls);
            Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/v1/vocabulary/definition-audio/prepare", new DefinitionAudioRequest
                { Word = "book", DefinitionId = new string('a', 64) })).StatusCode);
        }
        finally { AudioFixture.RemoveTestRoot(root); }
    }
}
