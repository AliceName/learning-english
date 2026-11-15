using System.Runtime.CompilerServices;

namespace EnglishLearning.Api.Tests;

internal static class AiWorkerTestIsolation
{
    // WebApplicationFactory otherwise uses the developer's real ContentRoot/App_Data.
    // These environment values affect the test process only; worker tests explicitly opt in.
    [ModuleInitializer]
    internal static void Initialize()
    {
        Environment.SetEnvironmentVariable("CourseGeneration__WorkerEnabled", "false");
        Environment.SetEnvironmentVariable("CourseGeneration__DataRoot",
            Path.Combine(Path.GetTempPath(), "els-isolated-tests-" + Guid.NewGuid().ToString("N")));
    }
}
