-- Approved profile improvements, 2026-11-10. No seeds or changes to existing profile values.
-- Apply after 001, 002 and 003. Safe to re-run; unexpected existing definitions abort.
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
        THROW 51020, 'Users is missing. Apply the baseline schema first.', 1;

    DECLARE @expected TABLE (ColumnName SYSNAME, TypeName SYSNAME, MaxLength SMALLINT, Nullable BIT);
    INSERT INTO @expected VALUES
        (N'PhoneNumber', N'nvarchar', 50, 1), (N'DateOfBirth', N'date', 3, 1),
        (N'Address', N'nvarchar', 1000, 1), (N'LearningPurpose', N'nvarchar', 40, 1),
        (N'PreferredSkill', N'nvarchar', 40, 1), (N'DailyGoalMinutes', N'int', 4, 1),
        (N'AuthVersion', N'int', 4, 0);
    IF EXISTS (SELECT 1 FROM @expected e JOIN sys.columns c
        ON c.object_id = OBJECT_ID(N'dbo.Users') AND c.name = e.ColumnName
        WHERE TYPE_NAME(c.user_type_id) <> e.TypeName OR c.max_length <> e.MaxLength OR c.is_nullable <> e.Nullable)
        THROW 51021, 'An existing profile column has an unexpected definition. No schema was changed.', 1;

    IF COL_LENGTH(N'dbo.Users', N'PhoneNumber') IS NULL ALTER TABLE dbo.Users ADD PhoneNumber NVARCHAR(25) NULL;
    IF COL_LENGTH(N'dbo.Users', N'DateOfBirth') IS NULL ALTER TABLE dbo.Users ADD DateOfBirth DATE NULL;
    IF COL_LENGTH(N'dbo.Users', N'Address') IS NULL ALTER TABLE dbo.Users ADD Address NVARCHAR(500) NULL;
    IF COL_LENGTH(N'dbo.Users', N'LearningPurpose') IS NULL ALTER TABLE dbo.Users ADD LearningPurpose NVARCHAR(20) NULL;
    IF COL_LENGTH(N'dbo.Users', N'PreferredSkill') IS NULL ALTER TABLE dbo.Users ADD PreferredSkill NVARCHAR(20) NULL;
    IF COL_LENGTH(N'dbo.Users', N'DailyGoalMinutes') IS NULL ALTER TABLE dbo.Users ADD DailyGoalMinutes INT NULL;
    IF COL_LENGTH(N'dbo.Users', N'AuthVersion') IS NULL
        ALTER TABLE dbo.Users ADD AuthVersion INT NOT NULL CONSTRAINT DF_Users_AuthVersion DEFAULT (0) WITH VALUES;

    IF NOT EXISTS (SELECT 1 FROM sys.columns c JOIN sys.default_constraints d ON d.object_id = c.default_object_id
        WHERE c.object_id = OBJECT_ID(N'dbo.Users') AND c.name = N'AuthVersion'
        AND REPLACE(REPLACE(d.definition, N'(', N''), N')', N'') = N'0')
        THROW 51022, 'AuthVersion must have the expected default of zero.', 1;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
