"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import Icon from "@/components/site-icon";
import type {Skill} from "@/lib/admin-courses";
import styles from "./admin.module.css";
export default function CourseSteps({courseId,published=false,firstSkill="speaking"}:{courseId?:number;published?:boolean;firstSkill?:Skill}) {
  const pathname = usePathname();
  const current = pathname.endsWith("/publish")?3:pathname.endsWith("/preview")?2:pathname.includes("/lessons/")?1:0;
  const base = `/admin/courses/${courseId}`;
  const steps = [{label:"Thông tin cơ bản",path:`${base}/general`},{label:"Xây dựng bài học",path:`${base}/lessons/${firstSkill}`},{label:"Xem trước",path:`${base}/preview`},{label:"Xuất bản",path:`${base}/publish`}];
  return <nav aria-label="Các bước tạo khóa học" className={styles.steps}>{steps.map((step,index)=>{
    const content=<><span className={styles.stepNumber}>{index<current || published?<Icon name="check"/>:index+1}</span><span><small>BƯỚC {index+1}</small><strong>{step.label}</strong></span></>;
    return courseId?<Link key={step.label} href={step.path} aria-current={current===index?"step":undefined}>{content}</Link>:<span key={step.label} aria-current={current===index?"step":undefined} aria-disabled={index>0}>{content}</span>;
  })}</nav>;
}
