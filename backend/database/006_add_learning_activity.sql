-- Apply explicitly to the application database. This change requires dbo.Users.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
    THROW 51023, 'Users must exist before applying script 006.', 1;

IF OBJECT_ID(N'dbo.UserLearningDays', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserLearningDays (
        UserId INT NOT NULL,
        StudyDate DATE NOT NULL,
        Kind INT NOT NULL,
        CONSTRAINT PK_UserLearningDays PRIMARY KEY (UserId, StudyDate, Kind),
        CONSTRAINT FK_UserLearningDays_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(UserId),
        CONSTRAINT CK_UserLearningDays_Kind CHECK (Kind BETWEEN 1 AND 8)
    );
END;

COMMIT TRANSACTION;
