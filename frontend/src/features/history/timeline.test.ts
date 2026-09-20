import { describe, expect, it } from 'vitest';
import { segmentsFor, dayKey, monday } from './timeline';

describe('history calendar intervals',()=>{
  it('splits a block at local midnight without losing any seconds',()=>{
    const start=new Date(2026,8,18,23,59,30),end=new Date(2026,8,19,0,0,40);
    const segments=segmentsFor([{id:1,blocks:[{started_at:start.toISOString(),ended_at:end.toISOString()}]}],['2026-09-18','2026-09-19']);
    expect(segments.map(segment=>segment.seconds)).toEqual([30,40]);
    expect(segments[0].endMinute).toBe(1440);
    expect(segments[1].startMinute).toBe(0);
  });
  it('never estimates a block for a legacy aggregate record',()=>{
    expect(segmentsFor([{id:1,actual_minutes:25,created_at:'2026-09-19T12:00:00',blocks:[]}],['2026-09-19'])).toEqual([]);
  });
  it('aligns Sunday with the preceding Monday across month boundaries',()=>{
    expect(dayKey(monday(new Date(2026,1,1,12)))).toBe('2026-01-26');
  });
});
