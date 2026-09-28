import { renderCalendarDay, segmentsFor } from './timeline';

// Seven fixed dates, with vertical scrolling only. Date navigation belongs
// to the toolbar so trackpad gestures cannot unexpectedly change the range.
export function createCalendar(container, data, {openRecord, scrollTop=480}) {
  const scroll=document.createElement('div');scroll.className='history-calendar-scroll';
  scroll.tabIndex=0;scroll.setAttribute('role','region');
  scroll.setAttribute('aria-label','Seven-day focus calendar. Scroll vertically to see all hours.');
  const grid=document.createElement('div');grid.className='history-calendar-grid';
  const axis=document.createElement('div');axis.className='history-time-axis';axis.setAttribute('aria-hidden','true');
  axis.innerHTML='<div class="history-axis-heading"><span title="Sessions under five minutes">Brief</span></div>';
  for(let h=0;h<24;h++) {
    const label=document.createElement('span');label.textContent=`${String(h).padStart(2,'0')}:00`;label.style.top=`${108+h*60}px`;axis.append(label);
  }
  grid.append(axis);
  const segments=segmentsFor(data.sessions,data.days.map(day=>day.date));
  for(const day of data.days)grid.append(renderCalendarDay(day,segments.filter(item=>item.date===day.date),openRecord));
  scroll.append(grid);container.replaceChildren(scroll);scroll.scrollTop=scrollTop;
  scroll.addEventListener('pointerdown',event=>grid.querySelectorAll('details[open]').forEach(details=>{if(!details.contains(event.target))details.open=false;}));
  scroll.addEventListener('keydown',event=>{if(event.key==='Escape')grid.querySelectorAll('details[open]').forEach(details=>{details.open=false;details.querySelector('summary').focus();});});
  return {get scrollTop(){return scroll.scrollTop;}};
}
