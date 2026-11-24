export function isProfileAvatar(url: string | null | undefined) {
  return !!url && /^\/avatars\/(profile|mascot-(cat|bear|fox))-(blue|purple|green|orange|pink|teal)\.svg$/.test(url);
}

export const avatarColors = [
  { value: "blue", label: "Xanh dương", hex: "#dce8ff" },
  { value: "purple", label: "Tím", hex: "#e9defa" },
  { value: "green", label: "Xanh lá", hex: "#dcf0dd" },
  { value: "orange", label: "Cam", hex: "#ffe8cd" },
  { value: "pink", label: "Hồng", hex: "#fbdde8" },
  { value: "teal", label: "Xanh ngọc", hex: "#d5efeb" },
] as const;
export const avatarCharacters = [
  { value: "cat", label: "Mèo" }, { value: "bear", label: "Gấu" }, { value: "fox", label: "Cáo" },
] as const;

export function avatarParts(url: string | null) {
  const match = url?.match(/^\/avatars\/mascot-(cat|bear|fox)-(blue|purple|green|orange|pink|teal)\.svg$/);
  const legacy = url?.match(/^\/avatars\/profile-(blue|purple|green|orange|pink|teal)\.svg$/);
  return { character: match?.[1] ?? "cat", color: match?.[2] ?? legacy?.[1] ?? "blue" };
}

export const mascotAvatar = (character: string, color: string) => `/avatars/mascot-${character}-${color}.svg`;
