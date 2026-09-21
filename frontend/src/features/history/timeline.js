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

export function renderTimeline(container, data, openRecord) {
  const segments = segmentsFor(data.sessions, data.days.map(day => day.date));
  const startHour = 0, hours = 24, scale = 1;
  container.replaceChildren();
  const clockChange = data.days.some(day => {
    const start = new Date(`${day.date}T00:00:00`);
    return start.getTimezoneOffset() !== nextDay(start).getTimezoneOffset();
  });
  const brief = segments.filter(entry => entry.seconds < 300);
  if (brief.length && !clockChange) {
    const strip = document.createElement('section'); strip.className = 'history-brief-strip';
    strip.innerHTML = '<div><h3>Brief sessions</h3><p>Under 5 minutes · kept here to keep the calendar readable.</p></div>';
    for (const day of data.days) {
      const entries = brief.filter(entry => entry.date === day.date);
      if (!entries.length) continue;
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `${new Date(`${day.date}T12:00:00`).toLocaleDateString([], {weekday:'short',day:'numeric'})} · ${entries.length} · ${duration(entries.reduce((total,entry) => total+entry.seconds,0))}`;
      details.append(summary);
      for (const entry of entries) {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = `${timeLabel(entry.start)} · ${duration(entry.seconds)} · ${entry.session.task_title}`;
        button.addEventListener('click', () => openRecord(entry.session,button));
        details.append(button);
      }
      strip.append(details);
    }
    container.append(strip);
  }
  const scroll = document.createElement('div'); scroll.className = `history-clock-scroll${clockChange ? ' as-agenda' : ''}`;
  scroll.tabIndex = 0; scroll.setAttribute('role','region'); scroll.setAttribute('aria-label','Weekly focus calendar, midnight to midnight. Scroll to see all hours.');
  const grid = document.createElement('div'); grid.className='history-week-grid';
  grid.classList.toggle('as-agenda',clockChange);
  grid.style.setProperty('--hours', String(hours));
  const axis = document.createElement('div'); axis.className='history-time-axis'; axis.setAttribute('aria-hidden','true');
  axis.innerHTML = '<div class="history-day-heading"></div>';
  for(let hour=startHour; hour < startHour+hours; hour++) {
    const label = document.createElement('span'); label.textContent=`${String(hour).padStart(2,'0')}:00`; label.style.top=`${64+(hour-startHour)*60}px`; axis.appendChild(label);
  }
  grid.appendChild(axis);
  for(const day of data.days) {
    const date = new Date(`${day.date}T12:00:00`);
    const column = document.createElement('section'); column.className='history-day';
    const heading = document.createElement('h3'); heading.className='history-day-heading';
    heading.innerHTML=`<span>${escapeHtml(date.toLocaleDateString([], {weekday:'short'}))}</span><strong${day.date === dayKey(new Date()) ? ' class="is-today"' : ''}>${date.getDate()}</strong><small>${day.minutes ? `${day.minutes} min` : day.seconds ? '<1 min' : '—'}</small>`;
    column.appendChild(heading);
    const body = document.createElement('div'); body.className='history-day-body';
    const entries = segments.filter(x=>x.date===day.date && (clockChange || x.seconds >= 300));
    column.classList.toggle('is-empty',!entries.length);
    // Allocate lanes using real time intervals; never inflate a block’s duration.
    const clusters = [];
    for(const entry of entries) {
      entry.top=(entry.startMinute-startHour*60)*scale;
      entry.height=(entry.endMinute-entry.startMinute)*scale;
      let cluster=clusters.at(-1);
      if(!cluster || entry.top>=cluster.end) { cluster={end:0,entries:[],lanes:[]}; clusters.push(cluster); }
      let lane=cluster.lanes.findIndex(end=>end<=entry.top);
      if(lane<0) lane=cluster.lanes.length;
      cluster.lanes[lane]=entry.top+entry.height;
      entry.lane=lane; cluster.entries.push(entry); cluster.end=Math.max(cluster.end,entry.top+entry.height);
    }
    for(const cluster of clusters) for(const entry of cluster.entries) {
      const button = document.createElement('button'); button.type='button'; button.className='history-block';
      const label = `${rangeLabel(entry.start,entry.end)} · ${duration(entry.seconds)} · ${entry.session.task_title}`;
      button.setAttribute('aria-label',label); button.title=label;
      button.style.top=`${entry.top}px`; button.style.height=`${entry.height}px`;
      button.style.left=`calc(${entry.lane/cluster.lanes.length*100}% + 3px)`;
      button.style.width=`calc(${100/cluster.lanes.length}% - 6px)`;
      button.classList.toggle('is-short',entry.height<62);
      button.classList.toggle('is-tiny',entry.height<24);
      button.innerHTML=`<span class="history-block-time">${escapeHtml(timeLabel(entry.start))}<span> · ${duration(entry.seconds)}</span></span><strong>${escapeHtml(entry.session.task_title)}</strong>`;
      button.addEventListener('click',()=>openRecord(entry.session,button));
      body.appendChild(button);
    }
    if(!entries.length) { const empty=document.createElement('p');empty.className='history-day-empty';empty.textContent=brief.some(entry=>entry.date===day.date) ? 'Brief sessions above' : day.session_ids?.length ? 'Record below' : 'No focus blocks';body.appendChild(empty); }
    column.appendChild(body);grid.appendChild(column);
  }
  if(clockChange) {
    const note=document.createElement('p');note.className='history-week-empty';
    note.textContent='This week includes a clock change. Blocks are shown in time order with their actual durations.';
    container.appendChild(note);
  }
  scroll.append(grid); container.append(scroll);
  // Start at the working day while retaining the complete, stable 24-hour axis.
  if (!clockChange) scroll.scrollTop = 8*60;
  if(!segments.length) {
    const message=document.createElement('p');message.className='history-week-empty';
    message.textContent='No recorded focus blocks this week. New rituals will appear here with their actual focus times.';
    container.appendChild(message);
  }
}
