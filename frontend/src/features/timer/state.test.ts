import { describe, it, expect } from 'vitest';
import { freshRitual, advance, remaining, payload, validSettings, defaults } from './state';
describe('ritual accounting', () => {
  it('credits elapsed focus only when skipping and no break time', () => {
    const start = freshRitual(defaults, 1000);
    const rest = advance(start, 91000);
    expect(rest.elapsedSeconds).toBe(90);
    const focus = advance(rest, 191000);
    expect(focus.elapsedSeconds).toBe(90);
    expect(focus.round).toBe(2);
  });
  it('does not invent hours of focus after sleeping through a deadline', () => {
    const start = freshRitual(defaults, 1000);
    const rest = advance(start, 1000 + 8*60*60000);
    expect(rest.elapsedSeconds).toBe(25*60);
    expect(remaining(rest, 1000+8*60*60000)).toBe(5*60);
  });
  it('restarts at round one after the long break', () => {
    let state = freshRitual(defaults, 0);
    for(let i=0;i<7;i++) state=advance(state,state.deadline);
    expect(state.breakKind).toBe('long');
    state=advance(state,state.deadline);
    expect(state.round).toBe(1);
    expect(state.elapsedSeconds).toBe(100*60);
  });
  it('keeps the same id for retrying a long ritual', () => {
    let state=freshRitual(defaults,0);
    delete state.startedAt; delete state.blocks; // legacy aggregate-only draft
    state.elapsedSeconds=900*60;
    state=advance(state,0,true);
    expect(payload(state).actual_minutes).toBe(900);
    expect(payload(state).client_id).toBe(state.id);
    expect(advance(state,999999)).toEqual(state);
  });
  it('rejects fractional, missing and unbounded settings', () => {
    expect(validSettings({...defaults,rounds:2.5})).toBe(false);
    expect(validSettings({...defaults,focus:Infinity})).toBe(false);
    expect(validSettings(null)).toBe(false);
  });
});


describe('recorded block times', () => {
  it('keeps actual focus intervals apart from breaks and delayed saving', () => {
    let state = freshRitual(defaults, Date.parse('2026-09-18T23:50:00Z'));
    state = advance(state, state.deadline);
    state = advance(state, state.deadline);
    state = advance(state, state.deadline - 15 * 60000, true);
    const body = payload(state);
    expect(body.blocks).toEqual([
      {started_at:'2026-09-18T23:50:00.000Z', ended_at:'2026-09-19T00:15:00.000Z'},
      {started_at:'2026-09-19T00:20:00.000Z', ended_at:'2026-09-19T00:30:00.000Z'},
    ]);
    expect(body.actual_minutes).toBe(35);
    expect(body.ended_at).toBe('2026-09-19T00:30:00.000Z');
    expect(payload(structuredClone(state))).toEqual(body);
  });
  it('stops a sleeping focus interval at its deadline and does not invent future blocks', () => {
    const state = advance(freshRitual(defaults, 0), 8 * 60 * 60000, true);
    expect(payload(state).blocks).toEqual([{started_at:'1970-01-01T00:00:00.000Z', ended_at:'1970-01-01T00:25:00.000Z'}]);
  });
  it('floors minutes once across short intervals, and supports immediate ending', () => {
    let state = advance(freshRitual(defaults, 0), 35000);
    state = advance(state, 40000);
    state = advance(state, 75000, true);
    expect(payload(state).actual_minutes).toBe(1);
    expect(payload(state).blocks).toHaveLength(2);
    expect(payload(advance(freshRitual(defaults, 0), 0, true)).blocks).toEqual([]);
  });
});
