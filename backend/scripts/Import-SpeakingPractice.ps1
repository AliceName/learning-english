param([switch]$Apply, [string]$CourseFile = (Join-Path $PSScriptRoot '../speaking-ai/training-practice-courses.json'))
$ErrorActionPreference = 'Stop'
$apiRoot = Join-Path $PSScriptRoot '../EnglishLearning.Api'
$courses = @(Get-Content $CourseFile -Raw -Encoding UTF8 | ConvertFrom-Json)
if ($courses.Count -eq 0 -or @($courses | Where-Object { $_.level -notin @('A1','A2','B1','B2','C1','C2') }).Count -gt 0) { throw 'Expected courses with valid CEFR content levels.' }
foreach ($course in $courses) {
    if ($course.lessons.Count -lt 1 -or $course.lessons.Count -gt 30) { throw 'Expected one to thirty lessons per course.' }
    foreach ($lesson in $course.lessons) {
        if ($lesson.sentences.Count -lt 1 -or $lesson.sentences.Count -gt 30) { throw 'Expected one to thirty sentences per lesson.' }
        foreach ($sentence in $lesson.sentences) {
            if ([string]::IsNullOrWhiteSpace($sentence) -or $sentence.Length -gt 300 -or $sentence -match '\d' -or ([regex]::Matches($sentence, "[A-Za-z]+(?:'[A-Za-z]+)*")).Count -gt 35) { throw 'Sentence exceeds model limits.' }
        }
    }
}
if (!$Apply) { $courses | Select-Object level,title,@{Name='Lessons';Expression={$_.lessons.Count}}; Write-Output 'Preview only. Pass -Apply to insert the approved sample courses.'; return }
$config = Get-Content (Join-Path $apiRoot 'appsettings.json') -Raw | ConvertFrom-Json
$dev = Get-Content (Join-Path $apiRoot 'appsettings.Development.json') -Raw | ConvertFrom-Json
$connectionString = $config.ConnectionStrings.DefaultConnection
if ($dev.ConnectionStrings.DefaultConnection) { $connectionString = $dev.ConnectionStrings.DefaultConnection }
if ($env:ConnectionStrings__DefaultConnection) { $connectionString = $env:ConnectionStrings__DefaultConnection }
$connection = [System.Data.SqlClient.SqlConnection]::new($connectionString)
$connection.Open()
$transaction = $connection.BeginTransaction([System.Data.IsolationLevel]::Serializable)
function Invoke-SeedCommand($sql, $values) {
    $command = $connection.CreateCommand()
    $command.Transaction = $transaction
    $command.CommandText = $sql
    foreach ($key in $values.Keys) { [void]$command.Parameters.AddWithValue("@$key", $values[$key]) }
    try { return $command.ExecuteScalar() } finally { $command.Dispose() }
}
$inserted = 0
$skipped = 0
try {
    foreach ($course in $courses) {
        $existing = Invoke-SeedCommand 'SELECT COUNT(*) FROM dbo.Courses WITH (UPDLOCK,HOLDLOCK) WHERE Title=@title' @{title=$course.title}
        if ($existing -gt 0) { $skipped++; continue }
        $id = Invoke-SeedCommand "INSERT dbo.Courses (Title,Description,SourceType,IsPublished) OUTPUT INSERTED.CourseId VALUES (@title,@description,N'system',1)" @{title=$course.title;description=$course.description}
        $order = 0
        foreach ($lesson in $course.lessons) {
            $order++
            $content = @{ version=1; speaking=@{ goals=$lesson.goals; sentences=@($lesson.sentences | ForEach-Object { @{text=$_} }) } } | ConvertTo-Json -Depth 8 -Compress
            [void](Invoke-SeedCommand "INSERT dbo.Lessons (CourseId,Title,SkillType,Content,OrderIndex,DifficultyLevel,EstimatedMinutes,IsActive) VALUES (@courseId,@title,N'speaking',@content,@order,@level,8,1)" @{courseId=$id;title=$lesson.title;content=$content;order=$order;level=$course.level})
        }
        $inserted++
    }
    $transaction.Commit()
    Write-Output "Committed: $inserted courses inserted; $skipped existing titles skipped. Existing content was not modified."
} catch { $transaction.Rollback(); throw } finally { $transaction.Dispose(); $connection.Dispose() }
