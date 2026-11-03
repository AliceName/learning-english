param([string]$CourseFile=(Join-Path $PSScriptRoot '../speaking-ai/cefr-practice/courses.json'),
      [string]$ReceiptPath=(Join-Path $PSScriptRoot '../speaking-ai/cefr-practice/import-receipt.json'))
$ErrorActionPreference='Stop'
$apiRoot=Join-Path $PSScriptRoot '../EnglishLearning.Api'
$config=Get-Content (Join-Path $apiRoot 'appsettings.json') -Raw | ConvertFrom-Json
$dev=Get-Content (Join-Path $apiRoot 'appsettings.Development.json') -Raw | ConvertFrom-Json
$connectionString=$config.ConnectionStrings.DefaultConnection
if($dev.ConnectionStrings.DefaultConnection){$connectionString=$dev.ConnectionStrings.DefaultConnection}
if($env:ConnectionStrings__DefaultConnection){$connectionString=$env:ConnectionStrings__DefaultConnection}
$courses=@(Get-Content $CourseFile -Raw -Encoding UTF8 | ConvertFrom-Json)
$connection=[System.Data.SqlClient.SqlConnection]::new($connectionString)
$connection.Open()
$receipt=@();$lessonCount=0;$sentenceCount=0
try {
    foreach($expected in $courses){
        $command=$connection.CreateCommand()
        $command.CommandText='SELECT c.CourseId,c.IsPublished,c.SourceType,l.LessonId,l.Title,l.Content,l.DifficultyLevel,l.OrderIndex,l.IsActive,l.SkillType FROM dbo.Courses c JOIN dbo.Lessons l ON l.CourseId=c.CourseId WHERE c.Title=@title ORDER BY l.OrderIndex,l.LessonId'
        [void]$command.Parameters.AddWithValue('@title',$expected.title)
        $table=[System.Data.DataTable]::new()
        $table.Load($command.ExecuteReader());$command.Dispose()
        if($table.Rows.Count -ne $expected.lessons.Count){throw "Unexpected lesson count for $($expected.title)"}
        $lessonIds=@()
        for($i=0;$i -lt $table.Rows.Count;$i++){
            $row=$table.Rows[$i];$lesson=$expected.lessons[$i]
            if(!$row.IsPublished -or !$row.IsActive -or $row.SourceType -ne 'system' -or $row.SkillType -ne 'speaking' -or $row.DifficultyLevel -cne $expected.level -or $row.Title -cne $lesson.title -or $row.OrderIndex -ne $i+1){throw 'Published lesson metadata mismatch'}
            $content=$row.Content | ConvertFrom-Json
            if($content.version -ne 1 -or $content.speaking.goals -cne $lesson.goals -or $content.speaking.sentences.Count -ne $lesson.sentences.Count){throw 'Speaking document mismatch'}
            for($j=0;$j -lt $lesson.sentences.Count;$j++){
                if($content.speaking.sentences[$j].text -cne $lesson.sentences[$j]){throw 'Sentence text mismatch'}
                $sentenceCount++
            }
            $lessonIds+=@{lessonId=[int]$row.LessonId;title=$lesson.title;sentenceCount=$lesson.sentences.Count;practiceUrl="http://localhost:3000/courses/$($row.CourseId)/speaking/$($row.LessonId)"}
            $lessonCount++
        }
        $receipt+=@{courseId=[int]$table.Rows[0].CourseId;title=$expected.title;level=$expected.level;lessons=$lessonIds}
    }
    $command=$connection.CreateCommand()
    $command.CommandText="SELECT COUNT(DISTINCT c.CourseId) AS Courses,COUNT(*) AS Lessons FROM dbo.Courses c JOIN dbo.Lessons l ON c.CourseId=l.CourseId WHERE c.Title LIKE N'%SpeechOcean762%'"
    $other=[System.Data.DataTable]::new();$other.Load($command.ExecuteReader());$command.Dispose()
    $result=@{verifiedAtUtc=[DateTime]::UtcNow.ToString('o');courseCount=$courses.Count;lessonCount=$lessonCount;sentenceCount=$sentenceCount;courses=$receipt;existingSpeechOceanCourses=[int]$other.Rows[0].Courses;existingSpeechOceanLessons=[int]$other.Rows[0].Lessons}
    $result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ReceiptPath -Encoding utf8
    Write-Output "Verified exact database content: $($courses.Count) courses, $lessonCount lessons, $sentenceCount sentences. Receipt: $ReceiptPath"
    Write-Output "SpeechOcean762 currently present: $($result.existingSpeechOceanCourses) courses, $($result.existingSpeechOceanLessons) lessons."
    Write-Output "First practice: $($receipt[0].lessons[0].practiceUrl)"
} finally {$connection.Dispose()}
