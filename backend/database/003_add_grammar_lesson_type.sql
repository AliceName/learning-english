-- Requested 2026-10-22: allow Grammar lessons in course authoring.
-- Apply after 001_initial_schema.sql and 002_add_user_role.sql.
-- Only widens CK_Lessons_SkillType. No columns, tables or data are added.
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID(N'dbo.Lessons', N'U') IS NULL
        THROW 51010, 'Lessons is missing. Apply the baseline schema first.', 1;

    DECLARE @definition NVARCHAR(MAX) = (
        SELECT definition FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID(N'dbo.Lessons') AND name = N'CK_Lessons_SkillType');
    IF @definition IS NULL
        THROW 51011, 'CK_Lessons_SkillType is missing. Review the database schema first.', 1;

    -- SQL Server expands IN into OR, in reverse order. Accept only the known baseline
    -- or this migration's definition, rather than overwriting an unrelated constraint.
    DECLARE @normalized NVARCHAR(MAX) = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        @definition, N' ', N''), N'(', N''), N')', N''), N'[', N''), N']', N''));
    DECLARE @original NVARCHAR(MAX) = N'skilltype=N''reading''ORskilltype=N''listening''ORskilltype=N''writing''ORskilltype=N''speaking''';
    DECLARE @updated NVARCHAR(MAX) = N'skilltype=N''grammar''ORskilltype=N''reading''ORskilltype=N''listening''ORskilltype=N''writing''ORskilltype=N''speaking''';

    IF @normalized NOT IN (LOWER(@original), LOWER(@updated))
        THROW 51012, 'Unexpected CK_Lessons_SkillType definition. No constraint was overwritten.', 1;

    IF @normalized = LOWER(@original)
    BEGIN
        ALTER TABLE [dbo].[Lessons] DROP CONSTRAINT [CK_Lessons_SkillType];
        ALTER TABLE [dbo].[Lessons] WITH CHECK ADD CONSTRAINT [CK_Lessons_SkillType]
            CHECK ([SkillType] IN (N'speaking', N'writing', N'listening', N'reading', N'grammar'));
    END;
    ALTER TABLE [dbo].[Lessons] WITH CHECK CHECK CONSTRAINT [CK_Lessons_SkillType];
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
