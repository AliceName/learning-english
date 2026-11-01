using System.Reflection;
using System.Text;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Configuration;
using System.IdentityModel.Tokens.Jwt;
using System.Threading.RateLimiting;
using EnglishLearning.Api.Services;
using EnglishLearning.Api.Services.CloudinaryMedia;
using EnglishLearning.Api.Services.MediaMigration;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Configuration.UserSecrets;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using MongoDB.Driver;

var builder = WebApplication.CreateBuilder(args);

// Explicit migration CLI: SELECT/Find reference audit only, no API listener, startup seed or DB/schema writes.
if (builder.Configuration["media-migration"] is not null)
{
    using var migrationDeadline = new CancellationTokenSource(TimeSpan.FromMinutes(20));
    Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; migrationDeadline.Cancel(); };
    Environment.ExitCode = await MediaMigrationCommand.RunAsync(builder.Configuration, builder.Environment.ContentRootPath, migrationDeadline.Token);
    return;
}

if (builder.Configuration["media-cutover"] is not null)
{
    using var cutoverDeadline = new CancellationTokenSource(TimeSpan.FromMinutes(20));
    Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; cutoverDeadline.Cancel(); };
    Environment.ExitCode = await MediaCutoverCommand.RunAsync(builder.Configuration, builder.Environment.ContentRootPath, cutoverDeadline.Token);
    return;
}

// Explicit environment check: no SQL/Mongo access, API listener, or runtime media-provider switch.
if (builder.Configuration.GetValue<bool>("cloudinary-smoke") || builder.Configuration.GetValue<bool>("cloudinary-adapter-smoke") ||
    builder.Configuration.GetValue<bool>("cloudinary-dictionary-smoke") || builder.Configuration.GetValue<bool>("cloudinary-course-smoke"))
{
    var configured = builder.Configuration.GetSection(CloudinarySettings.SectionName).Get<CloudinarySettings>() ?? new();
    CloudinarySmokeReport report;
    var recoveryPath = builder.Configuration["cloudinary-smoke-cleanup-report"];
    if (builder.Configuration.GetValue<bool>("cloudinary-course-smoke"))
        report = await CloudinaryAdapterSmoke.RunAsync(configured, builder.Environment.ContentRootPath, courseMedia: true);
    else if (builder.Configuration.GetValue<bool>("cloudinary-dictionary-smoke"))
        report = await CloudinaryAdapterSmoke.RunAsync(configured, builder.Environment.ContentRootPath, dictionaryAudio: true);
    else if (builder.Configuration.GetValue<bool>("cloudinary-adapter-smoke"))
        report = await CloudinaryAdapterSmoke.RunAsync(configured, builder.Environment.ContentRootPath);
    else if (!string.IsNullOrWhiteSpace(recoveryPath))
    {
        try
        {
            if (new FileInfo(recoveryPath).Length > 65536) throw new InvalidOperationException();
            var previous = System.Text.Json.JsonSerializer.Deserialize<CloudinarySmokeReport>(await File.ReadAllTextAsync(recoveryPath),
                new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)) ?? throw new InvalidOperationException();
            report = await CloudinarySmokeRecovery.RunAsync(configured, previous);
        }
        catch (Exception) { report = new("failed", DateTime.UtcNow, null, [], [], "invalid_smoke_recovery_report"); }
    }
    else report = await CloudinaryEnvironmentSmoke.RunAsync(configured);
    // Report provider names only to diagnose different local shells without disclosing values.
    var configurationProviders = ((IConfigurationRoot)builder.Configuration).Providers.Reverse().ToArray();
    report = report with { ConfigurationSources = new[] { "Enabled", "CloudName", "ApiKey", "ApiSecret", "EnvironmentPrefix" }
        .ToDictionary(key => key, key =>
        {
            var provider = configurationProviders.FirstOrDefault(candidate => candidate.TryGet("Cloudinary:" + key, out _));
            var label = provider?.GetType().Name ?? "missing";
            if (provider is FileConfigurationProvider file)
            {
                var filename = Path.GetFileName(file.Source.Path);
                if (filename is "secrets.json" or "appsettings.json" or "appsettings.Development.json" or "appsettings.Production.json")
                    label += ":" + filename;
            }
            return label;
        }) };
    var json = System.Text.Json.JsonSerializer.Serialize(report, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web) { WriteIndented = true });
    Console.WriteLine(json);
    var reportPath = builder.Configuration["cloudinary-smoke-report"];
    if (!string.IsNullOrWhiteSpace(reportPath)) await File.WriteAllTextAsync(reportPath, json);
    Environment.ExitCode = report.Status == "passed" ? 0 : report.Status == "not_configured" ? 2 : 1;
    return;
}

builder.Services.AddSingleton<IValidateOptions<CloudinarySettings>, CloudinarySettingsValidator>();
builder.Services.AddOptions<CloudinarySettings>().Bind(builder.Configuration.GetSection(CloudinarySettings.SectionName)).ValidateOnStart();
builder.Services.AddSingleton(services => CloudinaryClientFactory.Create(services.GetRequiredService<IOptions<CloudinarySettings>>().Value));
builder.Services.AddOptions<CloudinaryMediaOptions>().Bind(builder.Configuration.GetSection(CloudinaryMediaOptions.SectionName))
    .ValidateDataAnnotations().ValidateOnStart();
builder.Services.AddHttpClient("CloudinaryDelivery", client => client.Timeout = Timeout.InfiniteTimeSpan)
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    { AllowAutoRedirect = false, UseCookies = false, AutomaticDecompression = System.Net.DecompressionMethods.None });
builder.Services.AddSingleton<ICloudinaryAssetTransport, CloudinaryAssetTransport>();
builder.Services.AddSingleton<ICloudMediaStore, CloudinaryMediaStore>();
builder.Services.AddSingleton<MediaRuntimeState>();

if (builder.Environment.IsDevelopment())
{
    var secretsId = typeof(Program).Assembly.GetCustomAttribute<UserSecretsIdAttribute>()!.UserSecretsId;
    DevelopmentJwtSigningKey.EnsureConfigured(builder.Configuration,
        PathHelper.GetSecretsPathFromSecretsId(secretsId));
}

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException(
        "Configure ConnectionStrings:DefaultConnection before starting the API.");
}

builder.Services.AddDbContext<EnglishLearningDbContext>(options =>
    options.UseSqlServer(connectionString, sql => sql.CommandTimeout(10)));
builder.Services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddScoped<RegistrationService>();
builder.Services.AddScoped<LoginService>();
builder.Services.AddScoped<CourseCatalogService>();
builder.Services.AddScoped<CourseAuthoringService>();
builder.Services.AddDataProtection();
builder.Services.AddSingleton<ListeningGradingService>();
builder.Services.AddScoped<ListeningPracticeService>();
builder.Services.AddSingleton<IpaTranscriber>();
builder.Services.AddSingleton<MediaStorage>();
builder.Services.AddSingleton<IMediaStorage>(services => new CloudinaryCourseMediaStorage(
    () => services.GetRequiredService<ICloudMediaStore>(), () => services.GetRequiredService<ICloudinaryAssetTransport>(),
    () => services.GetRequiredService<MediaStorage>(), services.GetRequiredService<IOptions<CloudinarySettings>>()));
builder.Services.AddScoped<AdminBootstrapService>();
builder.Services.Configure<BootstrapAdminOptions>(builder.Configuration.GetSection(BootstrapAdminOptions.SectionName));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<JwtTokenService>();
builder.Services.AddSingleton<LoginAttemptLimiter>();
builder.Services.AddOptions<JwtOptions>()
    .Bind(builder.Configuration.GetSection(JwtOptions.SectionName))
    .ValidateDataAnnotations()
    .Validate(options => !string.IsNullOrWhiteSpace(options.SigningKey) && Encoding.UTF8.GetByteCount(options.SigningKey) >= 32,
        "Configure a JWT signing key with at least 32 bytes using User Secrets or Jwt__SigningKey.")
    .ValidateOnStart();
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
builder.Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
    .Configure<IOptions<JwtOptions>>((bearer, configured) =>
    {
        var jwt = configured.Value;
        bearer.MapInboundClaims = false;
        bearer.IncludeErrorDetails = false;
        bearer.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwt.Issuer,
            ValidateAudience = true,
            ValidAudience = jwt.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SigningKey)),
            RequireSignedTokens = true,
            RequireExpirationTime = true,
            ValidateLifetime = true,
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
            NameClaimType = "name",
            RoleClaimType = UserRoles.ClaimType,
            ClockSkew = TimeSpan.FromSeconds(30)
        };
    });
builder.Services.AddAuthorization();

builder.Services.AddControllers();
builder.Services.AddOpenApi(options =>
{
    options.AddDocumentTransformer((document, _, _) =>
    {
        document.Components ??= new OpenApiComponents();
        document.Components.SecuritySchemes["Bearer"] = new OpenApiSecurityScheme
        {
            Type = SecuritySchemeType.Http,
            Scheme = "bearer",
            BearerFormat = "JWT"
        };
        return Task.CompletedTask;
    });
    options.AddOperationTransformer((operation, context, _) =>
    {
        if (context.Description.ActionDescriptor.EndpointMetadata.OfType<IAuthorizeData>().Any())
            operation.Security.Add(new OpenApiSecurityRequirement
            {
                [new OpenApiSecurityScheme
                {
                    Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
                }] = []
            });
        return Task.CompletedTask;
    });
});
builder.Services.AddProblemDetails();

builder.Services.AddOptions<MongoDbSettings>().Bind(builder.Configuration.GetSection(MongoDbSettings.SectionName))
    .ValidateDataAnnotations().ValidateOnStart();
builder.Services.AddOptions<DictionaryApiSettings>().Bind(builder.Configuration.GetSection(DictionaryApiSettings.SectionName))
    .ValidateDataAnnotations().ValidateOnStart();
builder.Services.AddSingleton<IMongoClient>(services =>
{
    var configured = services.GetRequiredService<IOptions<MongoDbSettings>>().Value;
    var settings = MongoClientSettings.FromConnectionString(configured.ConnectionString);
    settings.ServerSelectionTimeout = TimeSpan.FromMilliseconds(configured.OperationTimeoutMs);
    settings.ConnectTimeout = TimeSpan.FromMilliseconds(configured.OperationTimeoutMs);
    settings.RetryWrites = false;
    return new MongoClient(settings);
});
builder.Services.AddSingleton(services => services.GetRequiredService<IMongoClient>()
    .GetDatabase(services.GetRequiredService<IOptions<MongoDbSettings>>().Value.DatabaseName));
builder.Services.AddSingleton<IVocabularyRepository, MongoVocabularyRepository>();
builder.Services.AddHttpClient("DictionaryApi", client =>
{
    client.BaseAddress = new Uri("https://api.dictionaryapi.dev/api/v2/entries/en/");
    client.Timeout = Timeout.InfiniteTimeSpan;
    client.DefaultRequestHeaders.Accept.ParseAdd("application/json");
});
builder.Services.AddSingleton<IDictionaryApiClient, DictionaryApiClient>();
builder.Services.AddSingleton<VocabularyLookupService>();
builder.Services.AddOptions<DictionaryAudioSettings>()
    .Bind(builder.Configuration.GetSection(DictionaryAudioSettings.SectionName)).ValidateDataAnnotations()
    .Validate(options => options.MaxCacheBytes >= options.MaxFileBytes * 2L && options.MaxPendingPreparations >= options.MaxConcurrentPreparations,
        "Audio cache capacity or preparation limits are invalid.").ValidateOnStart();
builder.Services.AddHttpClient("DictionaryAudio", (services, client) =>
{
    client.Timeout = Timeout.InfiniteTimeSpan;
    client.DefaultRequestHeaders.UserAgent.ParseAdd(services.GetRequiredService<IOptions<DictionaryAudioSettings>>().Value.UserAgent);
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false, AutomaticDecompression = System.Net.DecompressionMethods.None });
builder.Services.AddSingleton<WikimediaAudioResolver>();
builder.Services.AddSingleton<IDictionaryAudioDownload, DictionaryAudioDownload>();
builder.Services.AddSingleton<DictionaryAudioStorage>();
builder.Services.AddSingleton<IDictionaryAudioStorage>(services => new CloudinaryDictionaryAudioStorage(
    () => services.GetRequiredService<ICloudMediaStore>(), () => services.GetRequiredService<DictionaryAudioStorage>(),
    services.GetRequiredService<IOptions<CloudinarySettings>>(), services.GetRequiredService<IOptions<DictionaryAudioSettings>>()));
builder.Services.AddSingleton<DictionaryAudioService>();
builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy("VocabularyAudio", context => RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? "anonymous",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = builder.Configuration.GetValue<int?>("DictionaryAudioSettings:RequestsPerMinute") ?? 120,
            Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true
        }));
    options.AddPolicy("Vocabulary", context => RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? "anonymous",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = builder.Configuration.GetValue<int?>("DictionaryApiSettings:RequestsPerMinute") ?? 30,
            Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true
        }));
    options.OnRejected = async (context, token) =>
    {
        context.HttpContext.Response.StatusCode = 429;
        context.HttpContext.Response.Headers.CacheControl = "no-store";
        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
            context.HttpContext.Response.Headers.RetryAfter = Math.Ceiling(retryAfter.TotalSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture);
        await context.HttpContext.Response.WriteAsJsonAsync(new Microsoft.AspNetCore.Mvc.ProblemDetails
        {
            Status = 429, Title = "Bạn đã tra quá nhiều lần. Vui lòng chờ một lát.",
            Extensions = { ["code"] = "lookup_rate_limited" }
        }, cancellationToken: token);
    };
});

var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? [];
builder.Services.AddCors(options =>
    options.AddPolicy("Frontend", policy =>
        policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

if (builder.Configuration.GetValue<bool>("initialize-vocabulary"))
{
    using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15));
    var options = app.Services.GetRequiredService<IOptions<MongoDbSettings>>().Value;
    await MongoVocabularySchema.InitializeAsync(app.Services.GetRequiredService<IMongoDatabase>(), options.VocabularyCollectionName, deadline.Token);
    app.Logger.LogInformation("Vocabulary collection and validator initialized. No SQL schema was changed.");
    return;
}

// Explicit provisioning command only; normal startup never creates or resets accounts.
if (builder.Configuration.GetValue<bool>("bootstrap-admin"))
{
    await using var scope = app.Services.CreateAsyncScope();
    var result = await scope.ServiceProvider.GetRequiredService<AdminBootstrapService>().InitializeAsync();
    app.Logger.LogInformation("Admin bootstrap {Result}: {Email} (UserId {UserId}). Password was not printed.",
        result.Created ? "created" : "already exists", result.Email, result.UserId);
    return;
}

app.UseExceptionHandler();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.UseSwaggerUI(options =>
        options.SwaggerEndpoint("/openapi/v1.json", "English Learning API v1"));
}
else
{
    app.UseHttpsRedirection();
}

app.UseRouting();
app.UseCors("Frontend");
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.MapControllers();

app.Run();

public partial class Program { }
