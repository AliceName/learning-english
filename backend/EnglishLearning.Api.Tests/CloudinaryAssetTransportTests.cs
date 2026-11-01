using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using CloudinaryDotNet;
using EnglishLearning.Api.Configuration;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.Extensions.Options;

namespace EnglishLearning.Api.Tests;

public sealed class CloudinaryAssetTransportTests
{
    private const string Reference = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private const string Id = "els/test/courses/covers/" + Reference;
    private static byte[] Png => EnglishLearning.Api.Services.CloudinaryEnvironmentSmoke.Fixtures().Single(file => file.ResourceType == "image").Bytes;
    private sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> callback) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => callback(request, token);
    }
    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    { public HttpClient CreateClient(string name) => new(handler, false); }
    private static HttpResponseMessage Json(int status, object value) => new((HttpStatusCode)status)
    { Content = new StringContent(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json") };
    private static CloudinaryAssetTransport Transport(HttpMessageHandler upload, HttpMessageHandler? delivery = null, int readTimeout = 20)
    {
        var sdk = new Cloudinary(new Account("unit-cloud", "123456789012345", "secret-not-for-logs"));
        sdk.Api.Client = new HttpClient(upload, false);
        return new(sdk, new Factory(delivery ?? upload), Options.Create(new CloudinarySettings { EnvironmentPrefix = "els/test", ReadTimeoutSeconds = readTimeout }));
    }
    private static object AssetJson(string id = Id) => new { asset_id = "asset1", public_id = id, resource_type = "image", type = "authenticated", format = "png", version = 42, bytes = Png.Length };

    [Fact]
    public async Task Existing_upload_response_is_hydrated_by_targeted_metadata_lookup()
    {
        var calls = new List<System.Net.Http.HttpMethod>();
        using var handler = new Handler((request, _) =>
        {
            calls.Add(request.Method);
            return Task.FromResult(request.Method == System.Net.Http.HttpMethod.Post ? Json(200, new { existing = true, public_id = Id }) : Json(200, AssetJson()));
        });
        var result = await Transport(handler).UploadIfAbsentAsync(Id, "image", "png", Png, default);
        Assert.False(result.Created); Assert.Equal(Id, result.Asset.PublicId); Assert.Equal("image", result.Asset.ResourceType);
        Assert.Equal("42", result.Asset.Version); Assert.Equal(2, calls.Count);
    }

    [Theory]
    [InlineData(401, "Invalid Signature secret-not-for-logs", "media_storage_credentials_or_permission")]
    [InlineData(403, "Storage limit exceeded", "media_storage_quota_exceeded")]
    [InlineData(429, "too many requests", "media_storage_rate_limited")]
    public async Task Sdk_errors_do_not_become_conflicts_or_expose_provider_messages(int status, string message, string code)
    {
        var calls = 0;
        using var handler = new Handler((_, _) => { calls++; return Task.FromResult(Json(status, new { error = new { message } })); });
        var error = await Assert.ThrowsAsync<CloudMediaException>(() => Transport(handler).UploadIfAbsentAsync(Id, "image", "png", Png, default));
        Assert.Equal(code, error.Code); Assert.Equal(1, calls); Assert.DoesNotContain("secret-not-for-logs", error.ToString());
    }

    [Fact]
    public async Task Only_explicit_not_found_is_a_metadata_miss_and_foreign_paths_do_not_contact_sdk()
    {
        var calls = 0;
        using var handler = new Handler((_, _) => { calls++; return Task.FromResult(Json(404, new { error = new { message = "Not found" } })); });
        var transport = Transport(handler);
        Assert.Null(await transport.StatAsync(Id, "image", default));
        await Assert.ThrowsAsync<CloudMediaException>(() => transport.StatAsync("els/prod/courses/covers/" + Reference, "image", default));
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Cold_manifest_uses_delivery_and_cached_404_is_checked_against_exact_metadata()
    {
        var id = "els/test/courses/references/" + Reference + ".json";
        var adminCalls = 0; var deliveryCalls = 0;
        using var admin = new Handler((_, _) =>
        {
            adminCalls++;
            return Task.FromResult(Json(200, new { asset_id = "manifest", public_id = id, resource_type = "raw", type = "authenticated", version = 42, bytes = 2 }));
        });
        using var delivery = new Handler((request, _) =>
        {
            deliveryCalls++;
            if (deliveryCalls == 1) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
            return Task.FromResult(Json(200, new { }));
        });
        await using var read = await Transport(admin, delivery).OpenManifestAsync(id, default);
        Assert.NotNull(read); Assert.Equal(HttpStatusCode.OK, read.Status); Assert.Equal(1, adminCalls); Assert.Equal(2, deliveryCalls);
    }

    [Fact]
    public async Task Stream_body_read_obeys_deadline_after_headers_have_arrived()
    {
        using var handler = new Handler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        { Content = new StreamContent(new WaitingStream()) }));
        var transport = Transport(handler, readTimeout: 1);
        await using var response = await transport.OpenAsync(new("asset", Id, "image", "authenticated", "png", "1", 68), null, default);
        var error = await Assert.ThrowsAsync<CloudMediaException>(() => response.Body.ReadAsync(new byte[1]).AsTask());
        Assert.Equal("media_storage_timeout", error.Code);
    }

    private sealed class WaitingStream : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken token = default) { await Task.Delay(Timeout.Infinite, token); return 0; }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override void Flush() => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
