-- Approved 2026-10-21: Users.Role = admin/user, default user.
-- Run after 001_initial_schema.sql against the configured application database.
-- Safe to run again. No account credentials or automatic privilege promotion.
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
        THROW 51000, 'Users is missing. Apply 001_initial_schema.sql first.', 1;

    IF COL_LENGTH(N'dbo.Users', N'Role') IS NULL
        EXEC(N'ALTER TABLE [dbo].[Users] ADD [Role] NVARCHAR(20) NOT NULL
            CONSTRAINT [DF_Users_Role] DEFAULT (N''user'') WITH VALUES;');
    ELSE IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.Users') AND name = N'Role'
            AND system_type_id = TYPE_ID(N'nvarchar') AND max_length = 40 AND is_nullable = 0)
        THROW 51001, 'Users.Role differs from the approved NVARCHAR(20) NOT NULL schema.', 1;

    IF NOT EXISTS (
        SELECT 1 FROM sys.default_constraints d JOIN sys.columns c
            ON c.object_id = d.parent_object_id AND c.column_id = d.parent_column_id
        WHERE c.object_id = OBJECT_ID(N'dbo.Users') AND c.name = N'Role')
        EXEC(N'ALTER TABLE [dbo].[Users] ADD CONSTRAINT [DF_Users_Role] DEFAULT (N''user'') FOR [Role];');

    IF EXISTS (
        SELECT 1 FROM sys.default_constraints d JOIN sys.columns c
            ON c.object_id = d.parent_object_id AND c.column_id = d.parent_column_id
        WHERE c.object_id = OBJECT_ID(N'dbo.Users') AND c.name = N'Role'
            AND REPLACE(REPLACE(LOWER(d.definition), N'(', N''), N')', N'') NOT IN (N'n''user''', N'''user'''))
        THROW 51002, 'Users.Role has an unexpected default. No default was overwritten.', 1;

    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID(N'dbo.Users') AND name = N'CK_Users_Role')
        EXEC(N'ALTER TABLE [dbo].[Users] WITH CHECK ADD CONSTRAINT [CK_Users_Role]
            CHECK ([Role] COLLATE Latin1_General_100_BIN2 IN (N''admin'', N''user''));');

    EXEC(N'ALTER TABLE [dbo].[Users] WITH CHECK CHECK CONSTRAINT [CK_Users_Role];');
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
