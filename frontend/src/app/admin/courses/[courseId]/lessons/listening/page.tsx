import {Suspense} from "react";
import LessonBuilder from "@/components/admin/lesson-builder";
export const metadata={title:"Biên soạn Listening"};
async function Editor({searchParams}:{searchParams:Promise<{lesson?:string}>}){const{lesson}=await searchParams;return <LessonBuilder key={`listening-${lesson??"first"}`} skill="listening" selectedId={lesson!==undefined?Number(lesson):undefined}/>;}
export default function ListeningPage(props:{searchParams:Promise<{lesson?:string}>}){return <Suspense fallback={<p role="status">Đang tải bài Listening…</p>}><Editor {...props}/></Suspense>;}

export const instant=false;
