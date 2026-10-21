import type { SVGProps } from "react";

const icons = {
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  cards: <><path d="m5 5 12-3 4 16-12 3-4-16Z" /><path d="M3 9 1 10l4 12 3-1M9 8l7-2m-6 7 7-2" /></>,
  replay: <><path d="M3 10a9 9 0 1 1 2 9M3 4v6h6" /><path d="M12 7v5l3 2" /></>,
  bookmark: <path d="M6 3h12v18l-6-4-6 4V3Z" />,
  person: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  filter: <path d="M3 5h18M6 12h12m-9 7h6" />,
  brain: <><path d="M12 4a3 3 0 0 0-5-1 3 3 0 0 0-3 4 4 4 0 0 0-1 7 3 3 0 0 0 4 5 3 3 0 0 0 5 1V4Zm0 0a3 3 0 0 1 5-1 3 3 0 0 1 3 4 4 4 0 0 1 1 7 3 3 0 0 1-4 5 3 3 0 0 1-5 1" /><path d="M8 7c0 2-1 3-3 3m3 4c2 0 3 1 4 3m4-10c0 2 1 3 3 3m-3 4c-2 0-3 1-4 3M7 19v-3m10 3v-3" /></>,
  sparkles: <><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Zm7 0v4m-2-2h4" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m16 8-3 5-5 3 3-5 5-3Z" /></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  mic: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8" /></>,
  headphones: <><path d="M3 14v-3a9 9 0 0 1 18 0v3" /><rect x="3" y="11" width="4" height="9" rx="2" /><rect x="17" y="11" width="4" height="9" rx="2" /></>,
  writing: <><path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M7 16h5M7 12h2m5-5 4-4a2 2 0 0 1 3 3l-4 4-5 2 2-5Z" /></>,
  book: <><path d="M12 6C9 3 5 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-3-1-7-1-10 2Zm0 0v15" /></>,
  users: <><circle cx="9" cy="7" r="4" /><path d="M1 21v-2a8 8 0 0 1 16 0v2m0-18a4 4 0 0 1 0 8m6 10v-2a8 8 0 0 0-5-7" /></>,
  trend: <path d="m3 17 6-6 4 4 8-10m-7 0h7v7" />,
  star: <path d="m12 2 3.1 6.3L22 9.4l-5 4.8 1.2 6.8-6.2-3.3L5.8 21 7 14.2 2 9.4l6.9-1.1L12 2Z" />,
  flame: <path d="M13 2c1 6-5 7-5 11 0 2 1 3 3 4-1-4 3-4 3-7 4 3 6 5 5 8a7 7 0 0 1-13 0C2 10 11 9 13 2Z" />,
  bulb: <><path d="M8 17c0-4-3-4-3-8a7 7 0 0 1 14 0c0 4-3 4-3 8H8Zm1 4h6m-7-4h8" /></>,
  volume: <><path d="m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
  play: <path d="m8 4 12 8-12 8V4Z" />,
  pause: <><path d="M8 4v16M16 4v16" /></>,
  wave: <path d="M3 10v4m4-7v10m5-14v18m5-14v10m4-7v4" />,
  bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" />,
  upload: <><path d="M7 17H6a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 1 11h-2m-5 4V11m-4 4 4-4 4 4" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8m-8 4h5" /></>,
  briefcase: <><rect x="2" y="7" width="20" height="14" rx="3" /><path d="M8 7V3h8v4M2 12a24 24 0 0 0 20 0m-10 0v3" /></>,
  globe: <><circle cx="12" cy="12" r="10" /><ellipse cx="12" cy="12" rx="4" ry="10" /><path d="M2 12h20m-18-6h16M4 18h16" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  logout: <><path d="M9 3H4v18h5m0-9h13m-5-5 5 5-5 5" /></>,
};

export type SiteIconName = keyof typeof icons;

export default function SiteIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: SiteIconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{icons[name]}</svg>;
}
