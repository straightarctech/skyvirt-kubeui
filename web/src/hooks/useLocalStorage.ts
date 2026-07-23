import { useState, useEffect } from "react";

/**
 * State that persists to localStorage under `key`, so a user's choice survives
 * reloads and navigation. JSON-serialized; falls back to `initial` when the key
 * is absent or unreadable (private mode, quota, corrupt value).
 */
export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore write failures (private mode / quota) */
    }
  }, [key, value]);

  return [value, setValue];
}
