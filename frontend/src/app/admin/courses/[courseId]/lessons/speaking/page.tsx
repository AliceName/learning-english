import {Suspense} from "react";
import LessonBuilder from "@/components/admin/lesson-builder";
export const metadata={title:"Biên soạn Speaking"};
async function Editor({searchParams}:{searchParams:Promise<{lesson?:string}>}){const{lesson}=await searchParams;return <LessonBuilder key={`speaking-${lesson??"first"}`} skill="speaking" selectedId={lesson!==undefined?Number(lesson):undefined}/>;}
export default function SpeakingPage(props:{searchParams:Promise<{lesson?:string}>}){return <Suspense fallback={<p role="status">Đang tải bài Speaking…</p>}><Editor {...props}/></Suspense>;}

export const instant=false;
