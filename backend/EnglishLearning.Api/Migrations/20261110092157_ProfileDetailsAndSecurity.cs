using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EnglishLearning.Api.Migrations;

public partial class ProfileDetailsAndSecurity : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Catch up the already-approved Grammar constraint for databases managed by EF,
        // and tolerate databases where the versioned SQL scripts have already been applied.
        migrationBuilder.Sql(ReadScript("Migrations.003.sql"));
        migrationBuilder.Sql(ReadScript("Migrations.004.sql"));
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        throw new NotSupportedException("Profile data and revoked sessions must not be removed automatically. Restore from a reviewed backup instead.");

    private static string ReadScript(string resource)
    {
        using var stream = typeof(ProfileDetailsAndSecurity).Assembly.GetManifestResourceStream(resource)
            ?? throw new InvalidOperationException($"Missing migration resource: {resource}");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
