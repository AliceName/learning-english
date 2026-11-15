-- Approved 2026-11-14: optional course link for existing vocabulary decks.
-- Run explicitly against the intended database; this script is not run by the API.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID(N'dbo.FlashcardDecks', N'U') IS NULL OR OBJECT_ID(N'dbo.Courses', N'U') IS NULL
        THROW 51020, 'FlashcardDecks and Courses must exist before applying script 005.', 1;

    IF COL_LENGTH(N'dbo.FlashcardDecks', N'CourseId') IS NULL
        ALTER TABLE [dbo].[FlashcardDecks] ADD [CourseId] INT NULL;

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.FlashcardDecks')
        AND name = N'CourseId' AND system_type_id = TYPE_ID(N'int') AND is_nullable = 1 AND is_identity = 0)
        THROW 51021, 'Unexpected FlashcardDecks.CourseId definition. No column was overwritten.', 1;

    IF OBJECT_ID(N'dbo.FK_FlashcardDecks_Courses', N'F') IS NULL
        EXEC sys.sp_executesql N'ALTER TABLE [dbo].[FlashcardDecks] WITH CHECK ADD CONSTRAINT [FK_FlashcardDecks_Courses]
            FOREIGN KEY ([CourseId]) REFERENCES [dbo].[Courses] ([CourseId]) ON DELETE NO ACTION;';

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys fk
        JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
        WHERE fk.object_id = OBJECT_ID(N'dbo.FK_FlashcardDecks_Courses')
        AND fk.parent_object_id = OBJECT_ID(N'dbo.FlashcardDecks') AND fk.referenced_object_id = OBJECT_ID(N'dbo.Courses')
        AND COL_NAME(fkc.parent_object_id, fkc.parent_column_id) = N'CourseId'
        AND COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) = N'CourseId'
        AND fk.delete_referential_action = 0 AND fk.update_referential_action = 0)
        THROW 51022, 'Unexpected FK_FlashcardDecks_Courses definition. No relationship was overwritten.', 1;

    ALTER TABLE [dbo].[FlashcardDecks] WITH CHECK CHECK CONSTRAINT [FK_FlashcardDecks_Courses];
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
