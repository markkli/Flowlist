import { escapeHtml } from '../../shared/dom';
export const asDate = value => new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
export const dayKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function monday(date = new Date()) { const result = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12); result.setDate(result.getDate() - (result.getDay()+6)%7); return result; }
export function nextDay(date, count = 1) { const result = new Date(date); result.setDate(result.getDate()+count); return result; }
export const timeLabel = date => date.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
export function rangeLabel(start, end) {
  const clockChanged = start.getTimezoneOffset() !== end.getTimezoneOffset();
  const options = {hour:'numeric', minute:'2-digit', ...(clockChanged ? {timeZoneName:'short'} : {})};
  const endDay = dayKey(start) !== dayKey(end) ? `${end.toLocaleDateString([], {month:'short',day:'numeric'})} · ` : '';
  return `${start.toLocaleTimeString([],options)}–${endDay}${end.toLocaleTimeString([],options)}`;
}
export const duration = seconds => seconds < 60 ? `${seconds}s` : `${Math.floor(seconds/60)} min${seconds % 60 ? ` ${seconds%60}s` : ''}`;

export function segmentsFor(sessions, dates) {
  const visible = new Set(dates);
  const segments = [];
  for (const session of sessions) for (const block of session.blocks || []) {
    let cursor = asDate(block.started_at);
    const end = asDate(block.ended_at);
    while (cursor < end) {
      const midnight = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()+1);
      const until = new Date(Math.min(end.getTime(), midnight.getTime()));
      if (visible.has(dayKey(cursor))) {
        const startMinute = cursor.getHours()*60 + cursor.getMinutes() + cursor.getSeconds()/60;
        let endMinute = until.getTime() === midnight.getTime() ? 1440 : until.getHours()*60 + until.getMinutes() + until.getSeconds()/60;
        // A repeated DST hour has two real instants at the same wall-clock time.
        // Keep a visible block and use absolute times for duration and details.
        if (endMinute <= startMinute) endMinute = Math.min(1440, startMinute+(until-cursor)/60000);
        segments.push({session, block, date:dayKey(cursor), start:new Date(cursor), end:until, startMinute, endMinute, seconds:Math.round((until-cursor)/1000)});
      }
      cursor = until;
    }
  }
  return segments.sort((a,b) => a.start-b.start || a.session.id-b.session.id);
}

// Every date has the same header, compact-record row, and 24-hour body.
export function renderCalendarDay(day, segments, openRecord, {loading=false, retry=null}={}) {
  const date = new Date(`${day.date}T12:00:00`);
  const midnight = new Date(`${day.date}T00:00:00`);
  const clockChange = midnight.getTimezoneOffset() !== nextDay(midnight).getTimezoneOffset();
  const column = document.createElement('section');
  column.className='history-day'; column.dataset.date=day.date;
  const header=document.createElement('header');header.className='history-column-header';
  const heading=document.createElement('h3');heading.className='history-day-heading';
  heading.innerHTML=`<span>${escapeHtml(date.toLocaleDateString([], {weekday:'short'}))}</span><strong${day.date===dayKey(new Date())?' class="is-today"':''}>${date.getDate()}</strong><small>${day.minutes ? `${day.minutes} min` : day.seconds ? '<1 min' : '—'}</small>`;
  const brief=document.createElement('div');brief.className='history-day-brief';
  const compact=segments.filter(entry=>clockChange || entry.seconds<300);
  if(compact.length) {
    const details=document.createElement('details');
    const summary=document.createElement('summary');
    summary.textContent=clockChange ? `${compact.length} · clock change` : `${compact.length} brief`;
    summary.setAttribute('aria-label',`${date.toLocaleDateString([], {month:'short',day:'numeric'})}: ${compact.length} ${clockChange?'sessions on a clock-change day':'sessions under 5 minutes'}`);
    const list=document.createElement('div');list.className='history-brief-menu';
    for(const entry of compact) {
      const button=document.createElement('button');button.type='button';
      button.textContent=`${clockChange?rangeLabel(entry.start,entry.end):timeLabel(entry.start)} · ${duration(entry.seconds)} · ${entry.session.task_title}`;
      button.addEventListener('click',()=>{details.open=false;openRecord(entry.session,summary);});list.append(button);
    }
    details.append(summary,list);brief.append(details);
    details.addEventListener('toggle',()=>{
      header.classList.toggle('has-open-menu',details.open);
      if(details.open) {
        column.parentElement?.querySelectorAll('details[open]').forEach(other=>{if(other!==details)other.open=false;});
        const viewport=column.closest('.history-calendar-scroll').getBoundingClientRect();
        const bounds=header.getBoundingClientRect(), width=Math.min(260,viewport.width-60);
        list.style.width=`${width}px`;
        list.style.left=`${Math.max(viewport.left+52-bounds.left,Math.min(4,viewport.right-bounds.left-width-8))}px`;
      }
    });
  } else {
    brief.textContent=loading?'…':'—';
    brief.setAttribute('aria-label',loading?'Loading sessions':'No brief sessions');
  }
  header.append(heading,brief);column.append(header);
  const body=document.createElement('div');body.className='history-day-body';
  const entries=clockChange ? [] : segments.filter(entry=>entry.seconds>=300);
  // Real durations and overlap lanes; brief sessions never inflate the time scale.
  const clusters=[];
  for(const entry of entries) {
    entry.top=entry.startMinute; entry.height=entry.endMinute-entry.startMinute;
    let cluster=clusters.at(-1);
    if(!cluster || entry.top>=cluster.end){cluster={end:0,entries:[],lanes:[]};clusters.push(cluster);}
    let lane=cluster.lanes.findIndex(end=>end<=entry.top);
    if(lane<0)lane=cluster.lanes.length;
    cluster.lanes[lane]=entry.top+entry.height;entry.lane=lane;
    cluster.entries.push(entry);cluster.end=Math.max(cluster.end,entry.top+entry.height);
  }
  for(const cluster of clusters) for(const entry of cluster.entries) {
    const button=document.createElement('button');button.type='button';button.className='history-block';
    const label=`${rangeLabel(entry.start,entry.end)} · ${duration(entry.seconds)} · ${entry.session.task_title}`;
    button.setAttribute('aria-label',label);button.title=label;
    button.style.top=`${entry.top}px`;button.style.height=`${entry.height}px`;
    button.style.left=`calc(${entry.lane/cluster.lanes.length*100}% + 3px)`;
    button.style.width=`calc(${100/cluster.lanes.length}% - 6px)`;
    button.classList.toggle('is-short',entry.height<62);button.classList.toggle('is-tiny',entry.height<24);
    button.innerHTML=`<span class="history-block-time">${escapeHtml(timeLabel(entry.start))}<span> · ${duration(entry.seconds)}</span></span><strong>${escapeHtml(entry.session.task_title)}</strong>`;
    button.addEventListener('click',()=>openRecord(entry.session,button));body.append(button);
  }
  if(clockChange || retry || loading) {
    const message=document.createElement('div');message.className='history-day-message';
    message.textContent=clockChange?'Clock change. View sessions in the day header.':loading?'Loading…':'Could not load.';
    if(retry){const button=document.createElement('button');button.type='button';button.textContent='Retry';button.addEventListener('click',retry);message.append(button);}
    body.append(message);
  }
  column.append(body);return column;
}
