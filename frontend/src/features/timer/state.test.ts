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
