using Microsoft.Data.SqlClient;

namespace EnglishLearning.Api.Tests;

internal static class SqlServerTestTarget
{
    internal const string ConnectionVariable = "ENGLISHLEARNING_TEST_CONNECTION_STRING";
    internal const string CatalogVariable = "ENGLISHLEARNING_TEST_DATABASE";

    internal static string ConnectionString() => Validate(
        Environment.GetEnvironmentVariable(ConnectionVariable), Environment.GetEnvironmentVariable(CatalogVariable));

    internal static string Validate(string? connection, string? approvedCatalog)
    {
        if (string.IsNullOrWhiteSpace(connection) || string.IsNullOrWhiteSpace(approvedCatalog))
            throw new InvalidOperationException($"Configure {ConnectionVariable} and set {CatalogVariable} to the approved disposable catalog.");

        SqlConnectionStringBuilder settings;
        try { settings = new SqlConnectionStringBuilder(connection); }
        catch (ArgumentException) { throw new InvalidOperationException("Invalid SQL integration test connection configuration."); }

        var denied = new[] { "EnglishLearningDB", "master", "model", "msdb", "tempdb" };
        if (string.IsNullOrWhiteSpace(settings.DataSource) || !string.IsNullOrEmpty(settings.AttachDBFilename)
            || !settings.InitialCatalog.Equals(approvedCatalog, StringComparison.OrdinalIgnoreCase)
            || denied.Contains(settings.InitialCatalog, StringComparer.OrdinalIgnoreCase))
            throw new InvalidOperationException("The SQL connection must explicitly target the approved disposable test catalog.");

        return connection;
    }
}

public sealed class SqlServerTestTargetTests
{
    [Theory]
    [InlineData("Server=localhost;Database=EnglishLearningDB", "EnglishLearningDB")]
    [InlineData("Server=localhost;Database=master", "master")]
    [InlineData("Server=localhost", "WritingScratch")]
    [InlineData("Server=localhost;Database=WritingScratch", null)]
    [InlineData("Server=localhost;Database=Wrong", "WritingScratch")]
    [InlineData("Server=localhost;Database=WritingScratch;AttachDbFilename=C:/temp/app.mdf", "WritingScratch")]
    public void Rejects_unapproved_targets_before_opening_a_connection(string connection, string? approvedCatalog) =>
        Assert.Throws<InvalidOperationException>(() => SqlServerTestTarget.Validate(connection, approvedCatalog));

    [Fact]
    public void Accepts_explicit_matching_test_catalog_without_opening_a_connection()
    {
        const string connection = "Server=localhost;Initial Catalog=WritingScratch;Integrated Security=True";
        Assert.Equal(connection, SqlServerTestTarget.Validate(connection, "writingscratch"));
    }
}
