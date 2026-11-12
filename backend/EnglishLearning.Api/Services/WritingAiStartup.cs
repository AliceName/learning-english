using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Net.Http.Json;
using System.Text.Json;

namespace EnglishLearning.Api.Services;

internal sealed class WritingAiStartup(
    IWebHostEnvironment environment, IConfiguration configuration, ILogger<WritingAiStartup> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let the API listen while the local model loads.
        await Task.Yield();
        Process? owned = null;
        try
        {
            var baseUrl = new Uri(configuration["WritingAi:BaseUrl"] ?? "http://127.0.0.1:8000/");
            if (!OperatingSystem.IsWindows() || !baseUrl.IsLoopback || baseUrl.Port != 8000 ||
                baseUrl.Scheme != "http" || baseUrl.PathAndQuery != "/")
            {
                logger.LogInformation("Writing AI auto-start applies to Windows with the local HTTP service on port 8000.");
                return;
            }

            using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false })
            {
                BaseAddress = baseUrl,
                Timeout = TimeSpan.FromSeconds(2),
                MaxResponseContentBufferSize = 16 * 1024
            };
            if (await IsReadyAsync(http, stoppingToken))
            {
                logger.LogInformation("Reusing the healthy Writing AI service on port 8000.");
                return;
            }

            var writing = Path.GetFullPath("../../ai/writing", environment.ContentRootPath);
            var locks = Path.Combine(writing, ".cache", "locks");
            var startupLock = Path.Combine(locks, "writing-ai-start.lock");
            var timeout = Math.Clamp(configuration.GetValue("WritingAi:StartupTimeoutSeconds", 120), 1, 600);
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
            deadline.CancelAfter(TimeSpan.FromSeconds(timeout));

            if (!IsLocked(startupLock))
            {
                if (IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(listener => listener.Port == 8000))
                {
                    logger.LogWarning("Port 8000 is occupied by a listener that did not pass Writing AI health. No process was stopped.");
                    return;
                }
                if (IsLocked(Path.Combine(locks, "writing-gpu.lock")))
                {
                    logger.LogWarning("The Writing GPU lock is held. Writing AI auto-start was skipped.");
                    return;
                }

                var start = BuildLaunch(writing);
                stoppingToken.ThrowIfCancellationRequested();
                owned = Process.Start(start) ?? throw new InvalidOperationException("Writing launcher did not start.");
                owned.OutputDataReceived += (_, line) =>
                {
                    if (line.Data is not null) logger.LogDebug("Writing AI: {Output}", line.Data);
                };
                owned.ErrorDataReceived += (_, line) =>
                {
                    if (line.Data is not null) logger.LogInformation("Writing AI: {Output}", line.Data);
                };
                owned.BeginOutputReadLine();
                owned.BeginErrorReadLine();
                logger.LogInformation("Started Writing AI launcher PID {Pid}; waiting for readiness.", owned.Id);
            }

            while (!await IsReadyAsync(http, deadline.Token))
            {
                if (owned is { HasExited: true } && !IsLocked(startupLock))
                {
                    logger.LogWarning("Writing AI launcher exited before readiness with code {ExitCode}.", owned.ExitCode);
                    return;
                }
                await Task.Delay(300, deadline.Token);
            }

            if (owned is null || owned.HasExited)
            {
                logger.LogInformation("Reusing the Writing AI service started by another launcher.");
                return;
            }
            logger.LogInformation("Backend-owned Writing AI is ready.");
            await owned.WaitForExitAsync(stoppingToken);
            logger.LogWarning("Writing AI launcher exited with code {ExitCode}. The API remains running.", owned.ExitCode);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        catch (OperationCanceledException)
        {
            logger.LogWarning("Writing AI did not become ready within the startup timeout. The API remains running.");
        }
        catch (Exception error)
        {
            logger.LogWarning(error, "Writing AI auto-start failed. The API remains running.");
        }
        finally
        {
            if (owned is not null)
            {
                using (owned)
                {
                    try
                    {
                        if (!owned.HasExited)
                        {
                            owned.Kill(entireProcessTree: true);
                            if (!owned.WaitForExit(5000))
                                logger.LogWarning("Timed out waiting for the owned Writing AI launcher to exit.");
                        }
                    }
                    catch (Exception error) { logger.LogWarning(error, "Could not stop the owned Writing AI launcher."); }
                }
            }
        }
    }

    internal static ProcessStartInfo BuildLaunch(string writing)
    {
        var script = Path.Combine(writing, "Start-Writing.ps1");
        var python = Path.Combine(writing, ".venv", "Scripts", "python.exe");
        if (!File.Exists(script) || !File.Exists(python))
            throw new FileNotFoundException("Missing Start-Writing.ps1 or the local Writing Python environment.");

        var cefrRun = Environment.GetEnvironmentVariable("WRITING_CEFR_RUN")?.Trim();
        if (string.IsNullOrEmpty(cefrRun)) cefrRun = "artifacts/cefr-my-first-run";
        var gecRun = Environment.GetEnvironmentVariable("WRITING_GEC_RUN")?.Trim();
        if (string.IsNullOrEmpty(gecRun))
        {
            using var defaults = JsonDocument.Parse(File.ReadAllText(Path.Combine(writing, "model-defaults.json")));
            gecRun = defaults.RootElement.GetProperty("gecRun").GetString();
        }
        if (string.IsNullOrWhiteSpace(gecRun))
            throw new InvalidDataException("Missing default GEC run in model-defaults.json.");

        var cefr = RequireArtifact(writing, cefrRun, "CEFR");
        var gec = RequireArtifact(writing, gecRun, "GEC");
        var start = new ProcessStartInfo("powershell.exe")
        {
            WorkingDirectory = writing, CreateNoWindow = true, UseShellExecute = false,
            RedirectStandardOutput = true, RedirectStandardError = true
        };
        foreach (var argument in new[] { "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
                     "-CefrRun", cefr, "-GecRun", gec })
            start.ArgumentList.Add(argument);
        return start;
    }

    private static string RequireArtifact(string root, string run, string task)
    {
        var directory = Path.GetFullPath(run, root);
        foreach (var name in new[] { "run.json", "best/adapter_config.json", "best/adapter_model.safetensors", "best/tokenizer_config.json" })
            if (!File.Exists(Path.Combine(directory, name)))
                throw new FileNotFoundException($"Missing Writing {task} artifact: {name} in {directory}.");
        return directory;
    }

    private static bool IsLocked(string path)
    {
        try { using var file = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite); }
        catch (IOException error) when (error is not FileNotFoundException and not DirectoryNotFoundException) { return true; }
        catch (FileNotFoundException) { }
        catch (DirectoryNotFoundException) { }
        return false;
    }

    internal static async Task<bool> IsReadyAsync(HttpClient http, CancellationToken token)
    {
        try
        {
            var health = await http.GetFromJsonAsync<Health>("health", token);
            return health is { Status: "ready", CorrectionsEnabled: not null } &&
                !string.IsNullOrWhiteSpace(health.CefrRun) &&
                (health.CorrectionsEnabled == true ? !string.IsNullOrWhiteSpace(health.GecRun) : health.GecRun is null);
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested) { return false; }
        catch (Exception error) when (error is HttpRequestException or JsonException or NotSupportedException) { return false; }
    }

    private sealed record Health(string? Status, string? CefrRun, string? GecRun, bool? CorrectionsEnabled);
}
