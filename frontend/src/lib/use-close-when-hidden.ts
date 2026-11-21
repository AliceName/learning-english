import { useLayoutEffect, type RefObject } from "react";

/**
 * With cacheComponents, Next keeps the previous route mounted but hidden (React Activity, display:none).
 * A <dialog> opened with showModal() stays modal while hidden and makes the new page inert, so nothing
 * can be clicked until a reload. Close it when the component is hidden or unmounted.
 */
export function useCloseWhenHidden(dialog: RefObject<HTMLDialogElement | null>) {
  useLayoutEffect(() => {
    const node = dialog.current;
    return () => node?.close();
  }, [dialog]);
}
