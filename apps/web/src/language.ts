import { useSyncExternalStore } from "react";

export type Language = "en" | "zh";
const key = "nova-editor.language";
const subscribers = new Set<() => void>();
let language: Language = "en";
try { if (localStorage.getItem(key) === "zh") language = "zh"; } catch {}

function subscribe(listener: () => void) {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}

export function useLanguage() {
  return useSyncExternalStore(subscribe, () => language);
}

export function tr(english: string, chinese: string): string {
  return language === "zh" ? chinese : english;
}

export function setLanguage(next: Language) {
  if (next === language) return;
  language = next;
  try { localStorage.setItem(key, next); } catch {}
  subscribers.forEach(listener => listener());
}
