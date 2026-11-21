import Link from "next/link";
import Icon from "@/components/site-icon";
import type { PlanItem } from "./dashboard-model";
import { Panel, Skeleton } from "./dashboard-parts";
import styles from "./dashboard.module.css";

/** Up to three concrete things to do today; the first one is the page's primary action. */
export function TodayPlan({ plan, loading, studiedToday }: { plan: PlanItem[]; loading: boolean; studiedToday: boolean | null }) {
  return <Panel id="dashboard-today" title="Hôm nay nên làm" icon="check" busy={loading} className={styles.today}>
    {loading ? <Skeleton lines={3} /> : plan.length === 0
      ? <div className={styles.allDone}>
        <p><strong>Bạn đã xong các việc đến hạn.</strong> Có thể luyện thêm một kỹ năng bất kỳ.</p>
        <Link className={styles.secondary} href="/writing" prefetch={false}>Mở thư viện đề viết</Link>
      </div>
      : <ol className={styles.plan}>
        {plan.map((item, index) => <li key={item.key}>
          <span className={styles.planIcon}><Icon name={item.icon} /></span>
          <div><h3>{item.title}</h3><p>{item.detail}</p></div>
          <Link className={index === 0 ? styles.primary : styles.secondary} href={item.href} prefetch={false}>
            {item.cta}<Icon name="arrow" /></Link>
        </li>)}
      </ol>}
    {studiedToday === false && !loading && <p className={styles.nudge}>Làm một việc bất kỳ ở trên để giữ chuỗi ngày học.</p>}
  </Panel>;
}
