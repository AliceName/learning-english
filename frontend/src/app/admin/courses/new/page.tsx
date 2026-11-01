import GeneralCourseForm from "@/components/admin/general-course-form";
import styles from "@/components/admin/admin.module.css";
export const metadata={title:"Tạo khóa học mới"};
export default function NewCoursePage(){return <div className={styles.authoring}><GeneralCourseForm/></div>;}

export const instant=false;
