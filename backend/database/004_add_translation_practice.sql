-- Apply explicitly after the baseline. See DATABASE_SCHEMA.md, section 2.14.
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
        THROW 51020, 'Users is missing. Apply the baseline schema first.', 1;

    DECLARE @existing INT = (SELECT COUNT(*) FROM sys.tables
        WHERE schema_id = SCHEMA_ID(N'dbo') AND name IN
            (N'TranslationPrompts', N'TranslationAcceptedAnswers', N'UserTranslationPromptExposures'));
    IF @existing = 3
    BEGIN
        COMMIT TRANSACTION;
        RETURN;
    END;
    IF @existing <> 0
        THROW 51021, 'Translation practice schema is incomplete. Review the database before applying this script.', 1;

    CREATE TABLE dbo.TranslationPrompts (
        PromptId INT IDENTITY(1,1) NOT NULL,
        RotationKey UNIQUEIDENTIFIER NOT NULL,
        VietnameseText NVARCHAR(500) NOT NULL,
        CefrLevel NVARCHAR(10) NOT NULL,
        Topic NVARCHAR(80) NOT NULL,
        MeaningNotesJson NVARCHAR(MAX) NOT NULL,
        NormalizedVietnameseHash BINARY(32) NOT NULL,
        Availability NVARCHAR(16) NOT NULL,
        CONSTRAINT PK_TranslationPrompts PRIMARY KEY (PromptId),
        CONSTRAINT CK_TranslationPrompts_CefrLevel CHECK (CefrLevel COLLATE Latin1_General_100_BIN2 IN (N'A1', N'A2', N'B1')),
        CONSTRAINT CK_TranslationPrompts_Availability CHECK (Availability COLLATE Latin1_General_100_BIN2 IN (N'active', N'retired', N'blocked'))
    );
    CREATE UNIQUE INDEX UX_TranslationPrompts_ActiveHash ON dbo.TranslationPrompts (NormalizedVietnameseHash)
        WHERE Availability = N'active';
    CREATE UNIQUE INDEX UX_TranslationPrompts_ActiveRotation ON dbo.TranslationPrompts (RotationKey)
        WHERE Availability = N'active';

    CREATE TABLE dbo.TranslationAcceptedAnswers (
        AnswerId INT IDENTITY(1,1) NOT NULL,
        PromptId INT NOT NULL,
        EnglishText NVARCHAR(500) NOT NULL,
        NormalizedEnglishHash BINARY(32) NOT NULL,
        Source NVARCHAR(16) NOT NULL,
        ReviewStatus NVARCHAR(16) NOT NULL,
        CONSTRAINT PK_TranslationAcceptedAnswers PRIMARY KEY (AnswerId),
        CONSTRAINT FK_TranslationAcceptedAnswers_TranslationPrompts FOREIGN KEY (PromptId) REFERENCES dbo.TranslationPrompts (PromptId),
        CONSTRAINT CK_TranslationAcceptedAnswers_Source CHECK (Source COLLATE Latin1_General_100_BIN2 IN (N'original', N'student')),
        CONSTRAINT CK_TranslationAcceptedAnswers_ReviewStatus CHECK (ReviewStatus COLLATE Latin1_General_100_BIN2 IN (N'pending', N'approved', N'rejected'))
    );
    CREATE UNIQUE INDEX UX_TranslationAcceptedAnswers_PromptHash ON dbo.TranslationAcceptedAnswers (PromptId, NormalizedEnglishHash);
    CREATE UNIQUE INDEX UX_TranslationAcceptedAnswers_Original ON dbo.TranslationAcceptedAnswers (PromptId) WHERE Source = N'original';

    CREATE TABLE dbo.UserTranslationPromptExposures (
        UserId INT NOT NULL,
        RotationKey UNIQUEIDENTIFIER NOT NULL,
        LastShownAtUtc DATETIME2 NOT NULL,
        CONSTRAINT PK_UserTranslationPromptExposures PRIMARY KEY (UserId, RotationKey),
        CONSTRAINT FK_UserTranslationPromptExposures_Users FOREIGN KEY (UserId) REFERENCES dbo.Users (UserId)
    );
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
