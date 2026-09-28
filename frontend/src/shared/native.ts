import type { Ritual, TimerSettings } from '../features/timer/state';
export interface NativeTimer extends Ritual { nativePhase: string; paused: boolean; remainingSeconds: number }
export interface NativeState {
  account: {id:string; email:string} | null;
  needsSignIn?:boolean;
  planPendingCount?:number;
  planSyncIssue?:string|null;
  planSyncUncertain?:boolean;
  onboarding?: {version:number | null};
  timer: NativeTimer | null;
  settings: TimerSettings;
  preferences: {appearance:{preset:string; focusArtwork:boolean; planArtwork:boolean}; theme:string};
  notifications: 'granted' | 'denied' | 'default';
  sound:boolean;
  reminderPromptSeen?:boolean;
  syncing?:boolean;
  pendingCount?:number;
  error?:string | null;
  pendingRecords?:Array<{id:string;title:string;seconds:number;endedAt:string;note:string;error:string|null;errorCode:number|null}>;
}
type Reply<T> = {ok:true; value:T} | {ok:false; error:string; status?:number};
declare global { interface Window { webkit?: {messageHandlers?: {flowlist?: {postMessage(message:unknown):Promise<Reply<unknown>>}}} } }
export class NativeError extends Error { constructor(message:string, public status=0) {super(message);} }
export const isNative = () => Boolean(window.webkit?.messageHandlers?.flowlist);
let snapshot: NativeState | null = null;
export const nativeState = () => snapshot;
export function nativeConnectionLabel(state: NativeState): string {
  if (state.error || state.planSyncIssue) return 'Sync needs attention';
  if (state.syncing) return 'Syncing';
  const pending = (state.pendingCount || 0) + (state.planPendingCount || 0);
  if (pending) return `${pending} to sync`;
  return state.account ? 'Connected' : 'On this Mac';
}
export async function nativeCall<T=any>(op:string, args:Record<string,unknown>={}):Promise<T> {
  const handler=window.webkit?.messageHandlers?.flowlist;
  if(!handler) throw new NativeError('The Mac connection is unavailable. Reopen Flowlist.');
  const reply=await handler.postMessage({...args,op}) as Reply<T>;
  if(!reply || typeof reply.ok!=='boolean') throw new NativeError('The Mac app returned an invalid response.');
  if(!reply.ok) throw new NativeError(reply.error || 'Could not finish this action.', reply.status || 0);
  return reply.value;
}
export async function bootstrapNative() { snapshot=await nativeCall<NativeState>('bootstrap'); return snapshot; }
export function onNativeState(listener:(state:NativeState)=>void) {
  const receive=(event:Event)=>{ const value=(event as CustomEvent<NativeState>).detail; snapshot=value;listener(value); };
  window.addEventListener('flowlist:native-state',receive);
  return ()=>window.removeEventListener('flowlist:native-state',receive);
}
// Keep the latest snapshot even before a feature subscribes during boot.
if(typeof window!=='undefined') window.addEventListener('flowlist:native-state',event=>{snapshot=(event as CustomEvent<NativeState>).detail;});
