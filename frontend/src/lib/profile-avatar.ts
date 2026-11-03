export function isProfileAvatar(url: string | null | undefined) {
  return !!url && /^\/avatars\/profile-(blue|purple|green|orange|pink|teal)\.svg$/.test(url);
}
