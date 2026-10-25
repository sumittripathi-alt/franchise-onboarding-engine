// Storage with a safe fallback (G7.8). Every read and write goes through try/catch. If localStorage is
// unavailable (private mode, blocked, or full) the app keeps the session in memory and says so; it works
// fully either way.

export const STORAGE_KEY = "fpe.session.v1";
export const THEME_KEY = "fpe.theme";

export const MEMORY_NOTICE = "Your session won't be saved if you close this tab.";

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null; // accessing localStorage can itself throw (blocked site data)
  }
}

export function safeGetItem(key: string): string | null {
  try {
    return getStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Returns false if the value could not be saved (unavailable, blocked or full). */
export function safeSetItem(key: string, value: string): boolean {
  try {
    const s = getStorage();
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeRemoveItem(key: string): void {
  try {
    getStorage()?.removeItem(key);
  } catch {
    // nothing to do: the data lives in memory only
  }
}

/** Whether storage works right now (a probe write and read). */
export function storageWorks(): boolean {
  const probe = "fpe.probe";
  if (!safeSetItem(probe, "1")) return false;
  const ok = safeGetItem(probe) === "1";
  safeRemoveItem(probe);
  return ok;
}
