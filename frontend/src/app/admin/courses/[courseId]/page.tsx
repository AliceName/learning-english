import {redirect} from "next/navigation";
export default async function CoursePage({params}:{params:Promise<{courseId:string}>}){const{courseId}=await params;redirect(`/admin/courses/${courseId}/general`);}

export const instant=false;
