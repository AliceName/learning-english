using System.Net;
using System.Net.Http.Json;
using EnglishLearning.Api.Authentication;
using EnglishLearning.Api.Contracts;
using EnglishLearning.Api.Data;
using EnglishLearning.Api.Entities;
using EnglishLearning.Api.Services.CloudinaryMedia;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace EnglishLearning.Api.Tests;

public sealed partial class RegistrationSqlServerTests
{
    private static SaveLessonRequest ManagedLesson(string skill,string title,bool complete=true,bool active=true)
    {
        var content=skill switch
        {
            "speaking"=>SpeakingLesson(),"listening"=>ListeningLesson(),"grammar"=>GrammarLesson(),
            "writing"=>WritingLesson(),"reading"=>ReadingLesson(),_=>throw new ArgumentException("Unknown skill")
        };
        return new SaveLessonRequest
        {
            Title=title,SkillType=skill,DifficultyLevel=content.DifficultyLevel,EstimatedMinutes=content.EstimatedMinutes,IsActive=active,
            AudioUrl=content.AudioUrl,
            Speaking=skill=="speaking"?(complete?content.Speaking:new SpeakingContent()):null,
            Listening=skill=="listening"?(complete?content.Listening:new ListeningContent()):null,
            Grammar=skill=="grammar"?(complete?content.Grammar:new GrammarContent()):null,
            Writing=skill=="writing"?(complete?content.Writing:new WritingContent()):null,
            Reading=skill=="reading"?(complete?content.Reading:new ReadingContent()):null
        };
    }

    [SqlServerFact]
    public async Task Published_courses_allow_general_and_all_five_lesson_edits_and_valid_additions()
    {
        await AuthoringAdmin();
        var course=await NewReadingWritingCourse(["speaking","listening","grammar","writing","reading"]);
        var path=$"/api/v1/admin/courses/{course.CourseId}";
        foreach(var lesson in course.Lessons)
            Assert.Equal(HttpStatusCode.OK,(await client.PutAsJsonAsync($"{path}/lessons/{lesson.LessonId}",ManagedLesson(lesson.SkillType,lesson.Title))).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync(path+"/publish",null)).StatusCode);
        foreach(var lesson in course.Lessons)
        {
            var response=await client.PutAsJsonAsync($"{path}/lessons/{lesson.LessonId}",ManagedLesson(lesson.SkillType,"Updated "+lesson.SkillType));
            Assert.Equal(HttpStatusCode.OK,response.StatusCode);
            var saved=(await response.Content.ReadFromJsonAsync<AdminCourseResponse>())!;
            Assert.True(saved.IsPublished);Assert.Equal("Updated "+lesson.SkillType,saved.Lessons.Single(item=>item.LessonId==lesson.LessonId).Title);
            Assert.Equal(course.Lessons.Select(item=>item.LessonId),saved.Lessons.Select(item=>item.LessonId));
        }
        Assert.Equal(HttpStatusCode.OK,(await client.PutAsJsonAsync(path,new SaveCourseRequest{Title="Updated live course",Description="Updated description",CoverImageUrl=course.CoverImageUrl})).StatusCode);
        var added=await client.PostAsJsonAsync(path+"/lessons",ManagedLesson("speaking","Additional lesson"));
        Assert.Equal(HttpStatusCode.OK,added.StatusCode);
        Assert.Equal(6,(await added.Content.ReadFromJsonAsync<AdminCourseResponse>())!.Lessons.Count);
        var visible=(await client.GetFromJsonAsync<CourseDetailResponse>($"/api/v1/courses/{course.CourseId}"))!;
        Assert.Equal("Updated live course",visible.Course.Title);Assert.Equal(6,visible.Lessons.Count);
        Assert.Equal("Updated description",visible.Course.Description);
        Assert.True((await client.GetFromJsonAsync<AdminCourseResponse>(path))!.IsPublished);
    }

    [SqlServerFact]
    public async Task Published_edits_validate_candidates_before_save_and_hidden_courses_allow_unfinished_drafts()
    {
        await AuthoringAdmin();
        var course=await NewReadingWritingCourse(["speaking","listening","grammar","writing","reading"]);
        var path=$"/api/v1/admin/courses/{course.CourseId}";
        foreach(var lesson in course.Lessons)
            Assert.Equal(HttpStatusCode.OK,(await client.PutAsJsonAsync($"{path}/lessons/{lesson.LessonId}",ManagedLesson(lesson.SkillType,lesson.Title))).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync(path+"/publish",null)).StatusCode);
        var before=(await client.GetFromJsonAsync<AdminCourseResponse>(path))!;
        foreach(var lesson in before.Lessons)
        {
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync($"{path}/lessons/{lesson.LessonId}",ManagedLesson(lesson.SkillType,"Incomplete change",complete:false))).StatusCode);
            var unchanged=(await client.GetFromJsonAsync<AdminCourseResponse>(path))!;
            Assert.True(unchanged.IsPublished);Assert.Equal(before.UpdatedAt,unchanged.UpdatedAt);
            Assert.Equal(lesson.Title,unchanged.Lessons.Single(item=>item.LessonId==lesson.LessonId).Title);
        }
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,new SaveCourseRequest{Title="Incomplete general",Description="",CoverImageUrl=before.CoverImageUrl})).StatusCode);
        Assert.Equal(before.Title,(await client.GetFromJsonAsync<AdminCourseResponse>(path))!.Title);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync(path+"/lessons",ManagedLesson("speaking","Incomplete addition",complete:false))).StatusCode);
        Assert.Equal(5,(await client.GetFromJsonAsync<AdminCourseResponse>(path))!.Lessons.Count);

        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync(path+"/hide",null)).StatusCode);
        var hidden=(await client.GetFromJsonAsync<AdminCourseResponse>(path))!;Assert.False(hidden.IsPublished);
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync(path+"/hide",null)).StatusCode);
        Assert.Equal(hidden.UpdatedAt,(await client.GetFromJsonAsync<AdminCourseResponse>(path))!.UpdatedAt);
        var first=before.Lessons[0];
        Assert.Equal(HttpStatusCode.OK,(await client.PutAsJsonAsync($"{path}/lessons/{first.LessonId}",ManagedLesson(first.SkillType,"Work in progress",complete:false))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsync(path+"/publish",null)).StatusCode);
        Assert.False((await client.GetFromJsonAsync<AdminCourseResponse>(path))!.IsPublished);
        Assert.Equal(HttpStatusCode.OK,(await client.PutAsJsonAsync($"{path}/lessons/{first.LessonId}",ManagedLesson(first.SkillType,"Ready again"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync(path+"/publish",null)).StatusCode);
        var shown=(await client.GetFromJsonAsync<AdminCourseResponse>(path))!;Assert.True(shown.IsPublished);
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync(path+"/publish",null)).StatusCode);
        Assert.Equal(shown.UpdatedAt,(await client.GetFromJsonAsync<AdminCourseResponse>(path))!.UpdatedAt);
    }

    [SqlServerFact]
    public async Task Hiding_a_course_blocks_catalog_practice_and_media_and_showing_preserves_learning_data()
    {
        var admin=await AuthoringAdmin();var course=await NewAuthoringCourse();var path=$"/api/v1/admin/courses/{course.CourseId}";
        var cover=await CourseAsset("cover");var audio=await CourseAsset("audio");
        Assert.Equal(HttpStatusCode.OK,(await client.PutAsJsonAsync(path,new SaveCourseRequest{Title=course.Title,Description=course.Description,CoverImageUrl=cover.Url})).StatusCode);
        var speech=course.Lessons.Single(item=>item.SkillType=="speaking");var listening=course.Lessons.Single(item=>item.SkillType=="listening");
        Assert.Equal(HttpStatusCode.OK,(await client.PutAsJsonAsync($"{path}/lessons/{speech.LessonId}",SpeakingLesson(audioUrl:audio.Url))).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await client.PutAsJsonAsync($"{path}/lessons/{listening.LessonId}",ListeningLesson(audio.Url))).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync(path+"/publish",null)).StatusCode);

        var learner=await SignIn(await RegisterLoginUser());client.DefaultRequestHeaders.Authorization=new("Bearer",learner.AccessToken);
        var practice=PracticeUrl(course.CourseId,listening.LessonId);
        var content=(await client.GetFromJsonAsync<ListeningPracticeResponse>(practice))!;
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync(practice+"/start",null)).StatusCode);
        var submitted=await client.PostAsJsonAsync(practice+"/submissions",CorrectSubmission(content));Assert.Equal(HttpStatusCode.OK,submitted.StatusCode);
        var result=(await submitted.Content.ReadFromJsonAsync<ListeningResultResponse>())!;
        Assert.Equal(HttpStatusCode.OK,(await client.GetAsync(BackendAsset(audio))).StatusCode);
        client.DefaultRequestHeaders.Authorization=new("Bearer",admin.AccessToken);
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync(path+"/hide",null)).StatusCode);
        Assert.False((await client.GetFromJsonAsync<AdminCourseResponse>(path))!.IsPublished);
        Assert.Equal(HttpStatusCode.OK,(await client.GetAsync(BackendAsset(audio))).StatusCode); // Admin preview still works.

        client.DefaultRequestHeaders.Authorization=new("Bearer",learner.AccessToken);
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync($"/api/v1/courses/{course.CourseId}")).StatusCode);
        Assert.DoesNotContain((await client.GetFromJsonAsync<CourseListResponse>("/api/v1/courses"))!.Items,item=>item.CourseId==course.CourseId);
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync(practice)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await client.PostAsJsonAsync(practice+"/submissions",CorrectSubmission(content))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync(practice+"/results/"+result.Result.ResultId)).StatusCode);
        var remote=(MemoryCloudTransport)factory.Services.GetRequiredService<ICloudinaryAssetTransport>();var reads=remote.Reads;
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync(BackendAsset(audio))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync(BackendAsset(cover))).StatusCode);Assert.Equal(reads,remote.Reads);

        client.DefaultRequestHeaders.Authorization=new("Bearer",admin.AccessToken);
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync(path+"/publish",null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await client.PutAsJsonAsync($"{path}/lessons/{listening.LessonId}",new SaveLessonRequest
        {
            Title="Updated listening briefing",SkillType="listening",AudioUrl=audio.Url,
            Listening=new ListeningContent{Transcript="The meeting is on Thursday. Updated briefing.",Questions=ListeningLesson().Listening!.Questions}
        })).StatusCode);
        client.DefaultRequestHeaders.Authorization=new("Bearer",learner.AccessToken);
        Assert.Equal(HttpStatusCode.OK,(await client.GetAsync($"/api/v1/courses/{course.CourseId}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await client.GetAsync(BackendAsset(audio))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await client.PostAsJsonAsync(practice+"/submissions",CorrectSubmission(content))).StatusCode);
        var restored=(await client.GetFromJsonAsync<ListeningResultResponse>(practice+"/results/"+result.Result.ResultId))!;
        Assert.Equal(result.Result.ResultId,restored.Result.ResultId);Assert.Equal(result.Result.Score,restored.Result.Score);
        using var scope=factory.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        Assert.Equal(1,await db.UserCourses.CountAsync(item=>item.CourseId==course.CourseId&&item.UserId==learner.User.UserId));
        Assert.Equal(2,await db.Lessons.CountAsync(item=>item.CourseId==course.CourseId));
    }

    [SqlServerFact]
    public async Task Visibility_and_published_edits_enforce_admin_role_and_system_course_scope()
    {
        var admin=await AuthoringAdmin();var course=await NewReadingWritingCourse(["speaking"]);var path=$"/api/v1/admin/courses/{course.CourseId}";
        var lesson=course.Lessons[0];
        Assert.Equal(HttpStatusCode.OK,(await client.PutAsJsonAsync($"{path}/lessons/{lesson.LessonId}",ManagedLesson("speaking","Only active lesson"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync(path+"/publish",null)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync($"{path}/lessons/{lesson.LessonId}",ManagedLesson("speaking","Disabled",active:false))).StatusCode);
        var regular=await SignIn(await RegisterLoginUser());client.DefaultRequestHeaders.Authorization=new("Bearer",regular.AccessToken);
        Assert.Equal(HttpStatusCode.Forbidden,(await client.PostAsync(path+"/hide",null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await client.PostAsync(path+"/publish",null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await client.PutAsJsonAsync($"{path}/lessons/{lesson.LessonId}",ManagedLesson("speaking","Unauthorized edit"))).StatusCode);
        client.DefaultRequestHeaders.Authorization=null;
        Assert.Equal(HttpStatusCode.Unauthorized,(await client.PostAsync(path+"/hide",null)).StatusCode);
        client.DefaultRequestHeaders.Authorization=new("Bearer",admin.AccessToken);
        Assert.Equal(HttpStatusCode.NotFound,(await client.PostAsync("/api/v1/admin/courses/2147483647/hide",null)).StatusCode);
        using var scope=factory.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<EnglishLearningDbContext>();
        var personal=new Course{Title="Personal course",SourceType="user_upload",CreatedBy=regular.User.UserId};db.Courses.Add(personal);await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.NotFound,(await client.PostAsync($"/api/v1/admin/courses/{personal.CourseId}/hide",null)).StatusCode);
        await db.Users.Where(item=>item.UserId==admin.User.UserId).ExecuteUpdateAsync(set=>set.SetProperty(item=>item.Role,UserRoles.User));
        Assert.Equal(HttpStatusCode.Forbidden,(await client.PostAsync(path+"/hide",null)).StatusCode);
        await db.Users.Where(item=>item.UserId==admin.User.UserId).ExecuteUpdateAsync(set=>set.SetProperty(item=>item.IsActive,false));
        Assert.Equal(HttpStatusCode.Unauthorized,(await client.PostAsync(path+"/hide",null)).StatusCode);
    }
}
