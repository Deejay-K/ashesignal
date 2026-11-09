// Academy progress for the website, kept in this browser only.
const KEY = "ashesignal.academy.done";
export function readDone(): string[] { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; } }
export function markDone(id: string) { try { const d = new Set(readDone()); d.add(id); localStorage.setItem(KEY, JSON.stringify([...d])); } catch {} }
