import Link from "next/link";
import Icon, { type SiteIconName } from "@/components/site-icon";
import { Panel } from "./dashboard-parts";
import styles from "./dashboard.module.css";

export type Skill = { key: string; icon: SiteIconName; name: string; status: string; href: string; measured: boolean };

/** Every skill with what LEWA actually knows about it; unmeasured skills say so instead of showing a number. */
export function SkillsPanel({ skills }: { skills: Skill[] }) {
  return <Panel id="dashboard-skills" title="Các kỹ năng" icon="compass">
    <ul className={styles.skills}>
      {skills.map(skill => <li key={skill.key}>
        <span className={styles.skillIcon}><Icon name={skill.icon} /></span>
        <div><strong>{skill.name}</strong><span className={skill.measured ? undefined : styles.unmeasured}>{skill.status}</span></div>
        <Link href={skill.href} prefetch={false} aria-label={`Mở ${skill.name}`}><Icon name="chevron" /></Link>
      </li>)}
    </ul>
  </Panel>;
}
