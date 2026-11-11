import { isWritingTask, type WritingTask } from "./writing";
/** Drafts are local to the current browser tab session, never credentials or training labels. */
export type WritingDraft = {
  version: 2;
  task?: WritingTask | null;
  checkedRequirements?: number[];
  topic: string;
  text: string;
  corrections: boolean;
  baseSubmissionId: number | null;
  updatedAt: number;
};
export type WritingDraftInput = Pick<WritingDraft, "topic" | "text" | "corrections" | "baseSubmissionId" | "task" | "checkedRequirements">;
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type StoredDraft = WritingDraft & { owner: number | null };

function validId(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
}

function draftKey(owner: number | null, base: number | null, previous = false, taskId?: string | null): string | null {
  if ((owner !== null && !validId(owner)) || (base !== null && !validId(base))) return null;
  if (taskId != null && !/^[a-f0-9-]{36}$/u.test(taskId)) return null;
  return `linguaai:writing-draft:v1:${owner === null ? "anonymous" : `user:${owner}`}:${base === null ? `new${taskId ? `:task:${taskId}` : ""}` : `submission:${base}`}${previous ? ":before-login" : ""}`;
}

export function writingDraftStorage(): DraftStorage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}

function parse(raw: string | null, owner: number | null, base: number | null, taskId?: string | null): WritingDraft | null {
  if (!raw || raw.length > 100000) return null;
  try {
    const value = JSON.parse(raw) as StoredDraft;
    if (!value || typeof value !== "object" || ![1, 2].includes(value.version) || value.owner !== owner
      || value.baseSubmissionId !== base || typeof value.topic !== "string" || value.topic.length > 500
      || typeof value.text !== "string" || value.text.length > 12000 || typeof value.corrections !== "boolean"
      || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0
      || (value.task != null && !isWritingTask(value.task))
      || (taskId != null && value.task?.id !== taskId)
      || (value.checkedRequirements != null && (!Array.isArray(value.checkedRequirements)
        || new Set(value.checkedRequirements).size !== value.checkedRequirements.length
        || value.checkedRequirements.some(i => !Number.isInteger(i) || i < 0 || i >= (value.task?.requirements.length ?? 0))))) return null;
    return { version: 2, topic: value.topic, text: value.text, corrections: value.corrections,
      task: value.task ?? null, checkedRequirements: value.checkedRequirements ?? [],
      baseSubmissionId: base, updatedAt: value.updatedAt };
  } catch { return null; }
}

function read(storage: DraftStorage | null, key: string | null): string | null {
  try { return storage && key ? storage.getItem(key) : null; } catch { return null; }
}

function claimedDraft(storage: DraftStorage | null, owner: number, base: number | null, taskId?: string | null): WritingDraft | null {
  return parse(read(storage, draftKey(null, base, false, taskId)), owner, base, taskId);
}

export function loadWritingDraft(storage: DraftStorage | null, owner: number | null, base: number | null, taskId?: string | null): WritingDraft | null {
  const key = draftKey(owner, base, false, taskId);
  if (!key) return null;
  // A claimed anonymous draft remains readable by its owner if copying to a new key hit a storage quota.
  const saved = parse(read(storage, key), owner, base, taskId);
  const pending = owner !== null ? claimedDraft(storage, owner, base, taskId) : null;
  return pending && (!saved || pending.updatedAt > saved.updatedAt) ? pending : saved;
}

export function saveWritingDraft(storage: DraftStorage | null, owner: number | null, input: WritingDraftInput, now = Date.now()): boolean {
  const taskId = input.task?.id;
  const key = draftKey(owner, input.baseSubmissionId, false, taskId);
  if (!storage || !key) return false;
  const value: StoredDraft = { ...input, version: 2, updatedAt: now, owner };
  const raw = JSON.stringify(value);
  if (!parse(raw, owner, input.baseSubmissionId, taskId)) return false;
  try {
    storage.setItem(key, raw);
    if (owner !== null && claimedDraft(storage, owner, input.baseSubmissionId, taskId)) {
      // If removal fails, the claimed record cannot be adopted by another account.
      try { storage.removeItem(draftKey(null, input.baseSubmissionId, false, taskId)!); } catch { /* Owner copy remains valid. */ }
    }
    return true;
  } catch { return false; }
}

export function clearWritingDraft(storage: DraftStorage | null, owner: number | null, base: number | null, taskId?: string | null): boolean {
  const key = draftKey(owner, base, false, taskId);
  if (!storage || !key) return false;
  try {
    storage.removeItem(key);
    if (owner !== null && claimedDraft(storage, owner, base, taskId)) storage.removeItem(draftKey(null, base, false, taskId)!);
    return true;
  } catch { return false; }
}

/** Called only after successful login explicitly returning to Writing. */
export function adoptAnonymousWritingDraft(storage: DraftStorage | null, owner: number, base: number | null, now = Date.now(), taskId?: string | null): boolean {
  if (!storage || !validId(owner)) return false;
  const anonymousKey = draftKey(null, base, false, taskId);
  const ownerKey = draftKey(owner, base, false, taskId);
  if (!anonymousKey || !ownerKey) return false;
  const anonymous = parse(read(storage, anonymousKey), null, base, taskId);
  if (!anonymous) return false;
  const oldRaw = read(storage, ownerKey);
  const old = parse(oldRaw, owner, base, taskId);
  try {
    const adoptedAt = Math.max(now, (old?.updatedAt ?? 0) + 1, anonymous.updatedAt);
    // Claim before copying: even a failed removal cannot leak this draft to the next account.
    storage.setItem(anonymousKey, JSON.stringify({ ...anonymous, updatedAt: adoptedAt, owner }));
    if (old && (old.topic !== anonymous.topic || old.text !== anonymous.text || old.corrections !== anonymous.corrections
      || old.task?.id !== anonymous.task?.id || old.task?.version !== anonymous.task?.version
      || JSON.stringify(old.checkedRequirements ?? []) !== JSON.stringify(anonymous.checkedRequirements ?? []))) {
      storage.setItem(draftKey(owner, base, true, taskId)!, oldRaw!);
    }
    return saveWritingDraft(storage, owner, anonymous, adoptedAt);
  } catch { return false; }
}

export function loadPreviousWritingDraft(storage: DraftStorage | null, owner: number, base: number | null, taskId?: string | null): WritingDraft | null {
  if (!validId(owner)) return null;
  return parse(read(storage, draftKey(owner, base, true, taskId)), owner, base, taskId)
    ?? (claimedDraft(storage, owner, base, taskId) ? parse(read(storage, draftKey(owner, base, false, taskId)), owner, base, taskId) : null);
}

export function restorePreviousWritingDraft(storage: DraftStorage | null, owner: number, base: number | null, taskId?: string | null): WritingDraft | null {
  const previous = loadPreviousWritingDraft(storage, owner, base, taskId);
  if (!previous || !saveWritingDraft(storage, owner, previous)) return null;
  try { storage?.removeItem(draftKey(owner, base, true, taskId)!); } catch { /* Restored owner draft remains available. */ }
  return previous;
}
