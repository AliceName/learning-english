using System.Runtime.CompilerServices;

namespace EnglishLearning.Api.Tests;

internal static class TestEnvironmentDefaults
{
    /// <summary>
    /// Integration tests run as "Development", so they also read the developer's user-secrets. Environment variables win
    /// over user-secrets: pin Writing to the local grader so a machine set to plan B (Gemini) never spends real API calls
    /// or sends test essays out during a test run.
    /// </summary>
    [ModuleInitializer]
    internal static void PinLocalWritingGrader() => Environment.SetEnvironmentVariable("WritingAi__Provider", "local");
}
