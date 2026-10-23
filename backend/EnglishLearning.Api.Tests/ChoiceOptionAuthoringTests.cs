using System.Net;
using System.Net.Http.Json;
using EnglishLearning.Api.Contracts;

namespace EnglishLearning.Api.Tests;

public sealed partial class RegistrationSqlServerTests
{
    private static SaveLessonRequest ChoiceLesson(string skill,string[] options,int? correctIndex,bool errorCorrection=false)=>new()
    {
        Title="Flexible choice count",SkillType=skill,
        Listening=skill=="listening"?new ListeningContent{Questions=[new ListeningQuestion{Prompt="Choose an answer.",Options=options,CorrectOptionIndex=correctIndex}]}:null,
        Reading=skill=="reading"?new ReadingContent{Questions=[new ReadingQuestion{Prompt="Choose an answer.",Options=options,CorrectOptionIndex=correctIndex}]}:null,
        Grammar=skill=="grammar"?new GrammarContent{Questions=[new GrammarQuestion{Type=errorCorrection?"error_correction":"multiple_choice",Prompt="Choose an answer.",Options=options,CorrectOptionIndex=correctIndex,Correction=errorCorrection?"Corrected sentence.":null}]}:null
    };

    [SqlServerFact]
    public async Task Choice_questions_accept_two_to_four_options_and_reject_invalid_counts_or_answers()
    {
        await AuthoringAdmin();
        var course=await NewReadingWritingCourse(["reading","listening","grammar"]);
        foreach(var lesson in course.Lessons)
        {
            var path=$"/api/v1/admin/courses/{course.CourseId}/lessons/{lesson.LessonId}";
            foreach(var errorCorrection in lesson.SkillType=="grammar"?new[]{false,true}:new[]{false})
            {
                foreach(var count in new[]{2,3,4})
                {
                    var options=Enumerable.Range(0,count).Select(index=>$"Option {index+1}").ToArray();
                    Assert.Equal(HttpStatusCode.OK,(await client.PutAsJsonAsync(path,ChoiceLesson(lesson.SkillType,options,count-1,errorCorrection))).StatusCode);
                    var reloaded=(await client.GetFromJsonAsync<AdminCourseResponse>($"/api/v1/admin/courses/{course.CourseId}"))!.Lessons.Single(item=>item.LessonId==lesson.LessonId);
                    var savedOptions=reloaded.Reading?.Questions[0].Options??reloaded.Listening?.Questions[0].Options??reloaded.Grammar!.Questions[0].Options;
                    var savedIndex=reloaded.Reading?.Questions[0].CorrectOptionIndex??reloaded.Listening?.Questions[0].CorrectOptionIndex??reloaded.Grammar!.Questions[0].CorrectOptionIndex;
                    Assert.Equal(options,savedOptions);Assert.Equal(count-1,savedIndex);
                }
                foreach(var count in new[]{0,1,5,6})
                {
                    var options=Enumerable.Range(0,count).Select(index=>$"Option {index+1}").ToArray();
                    Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,ChoiceLesson(lesson.SkillType,options,0,errorCorrection))).StatusCode);
                }
                foreach(var index in new int?[]{null,-1,2})
                    Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,ChoiceLesson(lesson.SkillType,["A","B"],index,errorCorrection))).StatusCode);
                Assert.Equal(HttpStatusCode.BadRequest,(await client.PutAsJsonAsync(path,ChoiceLesson(lesson.SkillType,["A"," "],0,errorCorrection))).StatusCode);
                // Rejection must preserve the previously saved four-option question.
                var unchanged=(await client.GetFromJsonAsync<AdminCourseResponse>($"/api/v1/admin/courses/{course.CourseId}"))!.Lessons.Single(item=>item.LessonId==lesson.LessonId);
                Assert.Equal(4,(unchanged.Reading?.Questions[0].Options??unchanged.Listening?.Questions[0].Options??unchanged.Grammar!.Questions[0].Options).Length);
            }
        }
    }
}
