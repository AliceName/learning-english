using Microsoft.EntityFrameworkCore;

namespace EnglishLearning.Api.Data;

public sealed class EnglishLearningDbContext(
    DbContextOptions<EnglishLearningDbContext> options) : DbContext(options)
{
    // Add entity mappings only after checking DATABASE_SCHEMA.md and the existing database.
    // Schema creation and migrations are never run automatically by this application.
}
