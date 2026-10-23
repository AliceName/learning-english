"use client";
import type {Writing} from "@/lib/admin-courses";
import Icon from "@/components/site-icon";
import styles from "./admin.module.css";

export default function WritingRubricSummary({writing}:{writing:Writing}) {
  const total=writing.rubric.reduce((sum,item)=>sum+item.weight,0);
  function customize() {
    const details=document.getElementById("writing-rubric");
    if(details instanceof HTMLDetailsElement){details.open=true;details.scrollIntoView({behavior:"smooth",block:"start"});details.querySelector("input")?.focus({preventScroll:true});}
  }
  return <section className={styles.rubricSummary}><div className={styles.sectionHeader}><Icon name="clipboard"/><div><h2>Writing Rubric</h2><p>Tiêu chí đánh giá · Tổng {total}%</p></div></div>
    {writing.rubric.length?<ul>{writing.rubric.map((item,index)=><li key={index}><span>{item.name||`Tiêu chí ${index+1}`}</span><strong>{item.weight}%</strong></li>)}</ul>:<p className={styles.hint}>Chưa có tiêu chí đánh giá.</p>}
    <button type="button" className={styles.secondaryButton} onClick={customize}><Icon name="filter"/>Tùy biến trọng số chấm</button>
  </section>;
}
