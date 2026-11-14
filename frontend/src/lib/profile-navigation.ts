export const PROFILE_LEAVE = "lewa:profile-leave";
export function leaveProfile(action: () => void) {
  const event = new CustomEvent(PROFILE_LEAVE, { cancelable: true, detail: action });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) action();
}
