using System.Text.RegularExpressions;
using EnglishLearning.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;

namespace EnglishLearning.Api.Tests;

public sealed class SchemaModelTests
{
    [Fact]
    public void Every_table_column_and_constraint_matches_the_approved_markdown()
    {
        using var context = new EnglishLearningDbContext(
            new DbContextOptionsBuilder<EnglishLearningDbContext>()
                .UseSqlServer("Server=localhost;Database=ModelValidation;Integrated Security=True").Options);
        var schema = ApprovedSchema.Read();
        var entities = context.Model.GetEntityTypes().ToDictionary(entity => entity.GetTableName()!);
        Assert.Equal(13, schema.Count);
        Assert.Equal(122, schema.Values.Sum(columns => columns.Count));
        Assert.Equal(schema.Keys.Order(), entities.Keys.Order());

        foreach (var (table, columns) in schema)
        {
            var entity = entities[table];
            Assert.Equal("dbo", entity.GetSchema());
            Assert.Equal(columns.Select(column => column.Name).Order(), entity.GetProperties().Select(property => property.Name).Order());
            Assert.Empty(entity.GetIndexes());
            foreach (var column in columns)
            {
                var property = entity.FindProperty(column.Name)!;
                Assert.Equal(column.Type.ToLowerInvariant(), property.GetColumnType());
                Assert.Equal(column.Nullable, property.IsNullable);
                Assert.Equal(column.Identity, property.GetValueGenerationStrategy() == SqlServerValueGenerationStrategy.IdentityColumn);
                Assert.Equal(column.Rules.Contains("PK"), property.IsPrimaryKey());
                Assert.False(property.IsShadowProperty());
                var actualDefault = property.GetDefaultValueSql() ?? property.FindAnnotation(RelationalAnnotationNames.DefaultValue)?.Value?.ToString();
                Assert.Equal(ApprovedSchema.NormalizeDefault(column.Default), ApprovedSchema.NormalizeDefault(actualDefault));
            }
        }

        Assert.Equal(20, entities.Values.Sum(entity => entity.GetForeignKeys().Count()));
        Assert.Equal(2, entities.Values.Sum(entity => entity.GetForeignKeys().Count(foreignKey => foreignKey.DeleteBehavior == DeleteBehavior.Cascade)));
        Assert.All(entities.Values.SelectMany(entity => entity.GetForeignKeys()), foreignKey =>
            Assert.Contains(foreignKey.DeleteBehavior, new[] { DeleteBehavior.NoAction, DeleteBehavior.Cascade }));
        Assert.Equal(15, context.GetService<IDesignTimeModel>().Model.GetEntityTypes().Sum(entity => entity.GetCheckConstraints().Count()));
        Assert.Equal(4, entities.Values.Sum(entity => entity.GetKeys().Count(key => !key.IsPrimaryKey())));
    }
}

internal sealed record ApprovedColumn(string Name, string Type, string Rules)
{
    public bool Nullable => Rules.StartsWith("NULL", StringComparison.Ordinal);
    public bool Identity => Rules.Contains("IDENTITY");
    public string? Default => Regex.Match(Rules, @"DEFAULT (SYSDATETIME\(\)|'[^']*'|[0-9]+(?:\.[0-9]+)?)") is { Success: true } match ? match.Groups[1].Value : null;
}

internal static class ApprovedSchema
{
    public static Dictionary<string, List<ApprovedColumn>> Read()
    {
        var source = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "DATABASE_SCHEMA.md"));
        var result = new Dictionary<string, List<ApprovedColumn>>();
        foreach (var section in Regex.Split(source, @"(?m)^### 2\.\d+\. ").Skip(1))
        {
            var table = Regex.Match(section, @"^\w+").Value;
            var columns = Regex.Matches(section, @"(?m)^\| (\w+) \| ([A-Z][A-Z0-9]*(?:\([^)]*\))?) \| (.*?) \|")
                .Select(match => new ApprovedColumn(match.Groups[1].Value, match.Groups[2].Value, match.Groups[3].Value)).ToList();
            result.Add(table, columns);
        }
        return result;
    }

    public static string? NormalizeDefault(string? value) => value?
        .Replace("(", "").Replace(")", "").Replace("N'", "'").Replace("'", "")
        .Replace("True", "1").Replace("False", "0").ToLowerInvariant();
}
