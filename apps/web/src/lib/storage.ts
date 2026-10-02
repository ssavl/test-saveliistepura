import { Platform } from 'react-native';

const memory = new Map<string, string>();

function ls(): Storage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const storage = {
  get(key: string): string | null {
    try {
      const s = ls();
      if (s) return s.getItem(key);
    } catch {}
    return memory.get(key) ?? null;
  },
  set(key: string, value: string) {
    try {
      const s = ls();
      if (s) return s.setItem(key, value);
    } catch {}
    memory.set(key, value);
  },
  remove(key: string) {
    try {
      ls()?.removeItem(key);
    } catch {}
    memory.delete(key);
  },
  getJSON<T>(key: string, fallback: T): T {
    const raw = storage.get(key);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  setJSON(key: string, value: unknown) {
    storage.set(key, JSON.stringify(value));
  },
};
