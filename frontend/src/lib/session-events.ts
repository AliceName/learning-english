export const SESSION_CHANGED = "linguaai:session-changed";

export function notifySessionChanged() {
  window.dispatchEvent(new Event(SESSION_CHANGED));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(SESSION_CHANGED);
    channel.postMessage("changed");
    channel.close();
  }
}
