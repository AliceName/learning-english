"use client";
import {useRef,useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import Link from "next/link";
import Icon from "@/components/site-icon";
import {adminRequest,authoringSkills,lessonKinds,type AdminCourse,type Skill} from "@/lib/admin-courses";
import {levels} from "@/lib/course-catalog";
import {useOptionalWorkspace} from "./course-workspace";
import CourseSteps from "./course-steps";
import MediaField from "./media-field";
import styles from "./admin.module.css";
export default function GeneralCourseForm(){
  const workspace=useOptionalWorkspace();const course=workspace?.course;const router=useRouter();
  const[title,setTitle]=useState(workspace?.generalDraft?.title??course?.title??"");const[description,setDescription]=useState(workspace?.generalDraft?.description??course?.description??"");
  const[cover,setCover]=useState<string|null>(workspace?.generalDraft?workspace.generalDraft.coverImageUrl:course?.coverImageUrl??null);const[level,setLevel]=useState(course?.lessons[0]?.difficultyLevel??"B1");
  const[minutes,setMinutes]=useState(course?.lessons[0]?.estimatedMinutes??20);const[skills,setSkills]=useState<Skill[]>(["speaking","listening"]);
  const[pending,setPending]=useState(false);const[uploading,setUploading]=useState(false);const[error,setError]=useState("");const[saved,setSaved]=useState("");const inFlight=useRef(false);
  const readOnly=course?.isPublished??false;
  function changeTitle(value:string){setTitle(value);workspace?.setGeneralDraft(previous=>({...previous??{title,description,coverImageUrl:cover},title:value}));}
  function changeDescription(value:string){setDescription(value);workspace?.setGeneralDraft(previous=>({...previous??{title,description,coverImageUrl:cover},description:value}));}
  function changeCover(value:string|null){setCover(value);workspace?.setGeneralDraft(previous=>({...previous??{title,description,coverImageUrl:cover},coverImageUrl:value}));}
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(inFlight.current||uploading||readOnly)return;inFlight.current=true;setPending(true);setError("");setSaved("");
    const next=(event.nativeEvent as SubmitEvent).submitter?.getAttribute("value")==="next";
    try {
      const value=await adminRequest<AdminCourse>(course?`courses/${course.courseId}`:"courses",{method:course?"PUT":"POST",body:JSON.stringify({title,description,coverImageUrl:cover,...(!course?{difficultyLevel:level,estimatedMinutes:minutes,skills}:{})})});
      workspace?.replaceCourse(value,"general");setSaved("Đã lưu thông tin khóa học.");
      if(!course||next)router.push(`/admin/courses/${value.courseId}/${next?`lessons/${value.lessons[0]?.skillType??"speaking"}`:"general"}`);
    } catch(error){setError(error instanceof Error?error.message:"Không thể lưu khóa học.");}finally{inFlight.current=false;setPending(false);}
  }
  return <>{!course&&<><div className={styles.breadcrumb}><Link href="/admin/courses">Quản lý khóa học</Link><span>›</span><span>Tạo khóa học mới</span></div><div className={styles.pageHeader}><div><Link href="/admin/courses" className={styles.back}>← Quay về danh sách</Link><h1>Tạo khóa học mới</h1><p>Xây dựng lộ trình tiếng Anh phù hợp với học viên của bạn.</p></div><span className={styles.draft}>Bản nháp mới</span></div><CourseSteps/></>}
    <form onSubmit={save} className={styles.generalForm}>
      <section className={styles.panel}><div className={styles.sectionHeader}><span className={styles.sectionIcon}><Icon name="file"/></span><div><h2>1. Thông tin chung khóa học</h2><p>Thiết lập nội dung giới thiệu và bài học khởi đầu.</p></div><span className={styles.idBadge}>{course?`CRS-${course.courseId}`:"KHÓA HỌC MỚI"}</span></div>
        <fieldset disabled={readOnly||pending} className={styles.fieldset}>
          <div className={styles.field}><div className={styles.labelRow}><label htmlFor="course-title">Tên khóa học <em>*</em></label><small>{title.length}/255 ký tự</small></div><input id="course-title" value={title} onChange={event=>changeTitle(event.target.value)} maxLength={255} required placeholder="Ví dụ: Tiếng Anh giao tiếp cho người đi làm"/><p className={styles.hint}>Tên rõ ràng giúp học viên hiểu nội dung và mục tiêu khóa học.</p></div>
          <div className={styles.twoColumns}><div className={styles.field}><label htmlFor="course-level">CEFR mặc định cho bài học đầu tiên</label><select id="course-level" value={level} onChange={event=>setLevel(event.target.value)} disabled={!!course}>{levels.map(item=><option key={item}>{item}</option>)}</select></div><div className={styles.field}><label htmlFor="course-minutes">Thời lượng mỗi bài khởi tạo (phút)</label><input id="course-minutes" type="number" min={1} max={600} value={minutes} onChange={event=>setMinutes(Number(event.target.value))} disabled={!!course} required/></div></div>
          <div className={styles.field}><label>Kỹ năng khởi tạo</label><div className={styles.skillChoices}>{authoringSkills.map(skill=><button key={skill} type="button" aria-pressed={course?course.lessons.some(item=>item.skillType===skill):skills.includes(skill)} disabled={!!course} onClick={()=>setSkills(previous=>previous.includes(skill)?previous.length>1?previous.filter(item=>item!==skill):previous:[...previous,skill])}><Icon name={lessonKinds[skill].icon}/>{lessonKinds[skill].label}<Icon name={(course?course.lessons.some(item=>item.skillType===skill):skills.includes(skill))?"check":"plus"}/></button>)}</div><p className={styles.hint}>{course?"Điều chỉnh cấp độ, thời lượng và kỹ năng theo từng bài tại bước Xây dựng bài học.":"Mỗi kỹ năng được chọn sẽ tạo một bài học trống. Bạn có thể thêm và biên soạn tiếp ở bước 2."}</p></div>
          <div className={styles.field}><div className={styles.labelRow}><label htmlFor="course-description">Mô tả khóa học & mục tiêu đầu ra</label><span className={styles.mutedBadge}><Icon name="sparkles"/> AI viết lại · Sắp có</span></div><textarea id="course-description" value={description} onChange={event=>changeDescription(event.target.value)} rows={5} maxLength={10000} placeholder="Nội dung chính, đối tượng phù hợp và năng lực học viên sẽ đạt được…"/><small className={styles.hint}>{description.length} ký tự</small></div>
          <MediaField kind="cover" label="Ảnh bìa khóa học" value={cover} onChange={changeCover} onBusy={setUploading} disabled={readOnly||pending}/>
        </fieldset>
      </section>
      {error&&<p className={styles.error} role="alert">{error}</p>}{saved&&<p className={styles.success} role="status">{saved}</p>}
      <div className={styles.formFooter}><Link href="/admin/courses" className={styles.textButton}>Quay về danh sách</Link><div><button type="submit" value="draft" className={styles.secondaryButton} disabled={pending||uploading||readOnly}><Icon name="save"/>{pending?"Đang lưu…":"Lưu bản nháp"}</button><button type="submit" value="next" className={styles.primaryButton} disabled={pending||uploading||readOnly}>Tiếp tục: Xây dựng bài học <Icon name="arrow"/></button></div></div>
    </form>
  </>;
}
