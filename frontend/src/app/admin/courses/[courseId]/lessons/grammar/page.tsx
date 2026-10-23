import {Suspense} from "react";
import LessonBuilder from "@/components/admin/lesson-builder";

export const metadata={title:"Biên soạn Grammar"};
export const instant=false;

async function Editor({searchParams}:{searchParams:Promise<{lesson?:string}>}) {
  const {lesson}=await searchParams;
  return <LessonBuilder key={`grammar-${lesson??"first"}`} skill="grammar" selectedId={lesson!==undefined?Number(lesson):undefined}/>;
}
export default function GrammarPage(props:{searchParams:Promise<{lesson?:string}>}) {
  return <Suspense fallback={<p role="status">Đang tải bài Grammar…</p>}><Editor {...props}/></Suspense>;
}
