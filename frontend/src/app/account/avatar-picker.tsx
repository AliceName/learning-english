import Image from "next/image";
import { avatarCharacters, avatarColors, avatarParts, mascotAvatar } from "@/lib/profile-avatar";
import styles from "./profile.module.css";

export default function AvatarPicker({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  const { character, color } = avatarParts(value);
  return <fieldset className={styles.avatarPicker}>
    <legend>Tạo ảnh đại diện của bạn</legend>
    <p className={styles.hint}>Chọn nhân vật và màu nền yêu thích.</p>
    <div className={styles.characters}>
      <label><input type="radio" name="avatar-character" checked={value === null} onChange={() => onChange(null)} /><span className={styles.initialChoice}>Aa<small>Chữ cái</small></span></label>
      {avatarCharacters.map(item => <label key={item.value}><input type="radio" name="avatar-character" checked={value === mascotAvatar(item.value, color)} onChange={() => onChange(mascotAvatar(item.value, color))} /><span><Image src={mascotAvatar(item.value, color)} alt="" width={56} height={56} unoptimized /><small>{item.label}</small></span></label>)}
    </div>
    <fieldset className={styles.colors}><legend>Màu nền</legend><div>
      {avatarColors.map(item => <label key={item.value} title={item.label}><input type="radio" name="avatar-color" aria-label={item.label} checked={value !== null && color === item.value} onChange={() => onChange(mascotAvatar(character, item.value))} /><span style={{ background: item.hex }} /></label>)}
    </div></fieldset>
  </fieldset>;
}
