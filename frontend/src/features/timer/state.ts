import type { SessionPayload, Selection } from '../../shared/types';
export const RITUAL_KEY = 'flowlist-ritual-v2';
export interface TimerSettings { focus: number; break: number; rounds: number; longBreak: number }
export const defaults: TimerSettings = { focus: 25, break: 5, rounds: 4, longBreak: 15 };
export type Phase = 'focus' | 'break' | 'awaiting-attribution' | 'saving' | 'saved';
export interface Ritual {
  id: string; phase: Phase; elapsedSeconds: number; round: number; settings: TimerSettings;
  deadline: number; blockSeconds: number; breakKind: 'short' | 'long'; minimized: boolean;
  summary: string; selections: Selection[]; draftTask: string; draftDestination: string; draftGroup: string; draftGroupType: string;
}
export function validSettings(value: unknown): value is TimerSettings {
  const v = value as TimerSettings;
  return !!v && [v.focus, v.break, v.rounds, v.longBreak].every(Number.isInteger) && v.focus >= 5 && v.focus <= 120 && v.break >= 1 && v.break <= 60 && v.rounds >= 2 && v.rounds <= 8 && v.longBreak >= 5 && v.longBreak <= 90;
}
export function freshRitual(settings: TimerSettings, now = Date.now()): Ritual {
  return { id: crypto.randomUUID(), phase: 'focus', elapsedSeconds: 0, round: 1, settings: {...settings}, deadline: now + settings.focus * 60000, blockSeconds: settings.focus * 60, breakKind: 'short', minimized: false, summary: '', selections: [], draftTask: '', draftDestination: '__tasks__', draftGroup: '', draftGroupType: 'project' };
}
export function remaining(state: Ritual, now = Date.now()): number { return Math.max(0, Math.ceil((state.deadline - now) / 1000)); }
/** Only the current focus block is credited after sleep; never invent unattended future rounds. */
export function advance(state: Ritual, now = Date.now(), end = false): Ritual {
  const next = structuredClone(state);
  if (!['focus','break'].includes(next.phase)) return next;
  if (next.phase === 'focus') next.elapsedSeconds += Math.max(0, Math.min(next.blockSeconds, next.blockSeconds - remaining(next, now)));
  if (end) { next.phase = 'awaiting-attribution'; next.minimized = false; return next; }
  if (next.phase === 'focus') {
    next.phase = 'break'; next.breakKind = next.round >= next.settings.rounds ? 'long' : 'short';
    next.blockSeconds = (next.breakKind === 'long' ? next.settings.longBreak : next.settings.break) * 60;
  } else {
    next.round = next.breakKind === 'long' ? 1 : next.round + 1;
    next.phase = 'focus'; next.blockSeconds = next.settings.focus * 60;
  }
  next.deadline = now + next.blockSeconds * 1000;
  return next;
}
export function payload(state: Ritual): SessionPayload {
  const minutes = Math.floor(state.elapsedSeconds / 60);
  return { client_id: state.id, planned_minutes: Math.max(1, minutes), actual_minutes: minutes, completed: true, summary: state.summary.trim() || null, tasks: state.selections };
}
export function readRitual(storage: Storage = localStorage): Ritual | null {
  try {
    const value = JSON.parse(storage.getItem(RITUAL_KEY) || 'null') as Ritual | null;
    if (!value) return null;
    if (!value.id || !validSettings(value.settings) || !['focus','break','awaiting-attribution','saving','saved'].includes(value.phase) || !Number.isFinite(value.elapsedSeconds) || value.elapsedSeconds < 0 || !Number.isFinite(value.deadline) || !Number.isFinite(value.blockSeconds) || value.blockSeconds <= 0 || typeof value.summary !== "string" || !Array.isArray(value.selections) || !value.selections.every(item => Number.isInteger(item.task_id) && typeof item.completed === "boolean") || !Number.isInteger(value.round) || value.round < 1 || value.round > value.settings.rounds) return null;
    return value;
  } catch { return null; }
}
export function migrateLegacy(settings: TimerSettings): Ritual | null {
  if (localStorage.getItem(RITUAL_KEY)) return readRitual();
  try {
    const timer = JSON.parse(localStorage.getItem('flowlist-active-focus') || 'null');
    const old = JSON.parse(localStorage.getItem('flowlist-focus-ritual') || 'null');
    if (!timer && !old) return null;
    const state = freshRitual(settings);
    state.elapsedSeconds = Math.max(0, Number(old?.elapsed_seconds) || 0);
    if (timer && ['focus','break'].includes(timer.phase) && Number.isFinite(timer.deadline)) {
      state.phase = timer.phase; state.deadline = timer.deadline; state.blockSeconds = Number(timer.planned_seconds) || Number(timer.planned_minutes) * 60 || settings.focus * 60;
      state.round = timer.round_number || 1; state.breakKind = timer.break_kind || 'short';
    } else { state.phase = 'awaiting-attribution'; }
    localStorage.setItem(RITUAL_KEY, JSON.stringify(state));
    ['flowlist-active-focus','flowlist-focus-ritual','flowlist-pomodoro-cycle'].forEach(key => localStorage.removeItem(key));
    return state;
  } catch { return null; }
}
