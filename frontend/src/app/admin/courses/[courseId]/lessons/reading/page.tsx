import {Suspense} from "react";
import LessonBuilder from "@/components/admin/lesson-builder";
export const metadata={title:"Biên soạn Reading"};
export const instant=false;
async function Editor({searchParams}:{searchParams:Promise<{lesson?:string}>}) {
  const {lesson}=await searchParams;
  return <LessonBuilder key={`reading-${lesson??"first"}`} skill="reading" selectedId={lesson!==undefined?Number(lesson):undefined}/>;
}
export default function Page(props:{searchParams:Promise<{lesson?:string}>}) {
  return <Suspense fallback={<p role="status">Đang tải bài Reading…</p>}><Editor {...props}/></Suspense>;
}
