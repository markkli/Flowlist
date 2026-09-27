import { dayKey, nextDay, renderTimeline } from './timeline';

// Three native scroll-snap pages are recycled around the selected week.
// Adjacent data is prefetched; moving one week never downloads the full archive.
export function renderWeekPager(container, week, data, {loadWeek, openRecord, onNavigate, scrollTop = 480}) {
  const pager = document.createElement('div');
  pager.className = 'history-week-pager';
  pager.tabIndex = 0;
  pager.setAttribute('role','region');
  pager.setAttribute('aria-label','Focus calendar. Scroll horizontally or use left and right arrow keys to change weeks.');
  const panels = [-1,0,1].map(offset => {
    const panel = document.createElement('section');
    panel.className = 'history-week-page';
    panel.dataset.week = dayKey(nextDay(week,offset*7));
    panel.dataset.current = String(offset===0);
    panel.inert = offset !== 0;
    panel.setAttribute('aria-hidden', String(offset !== 0));
    pager.append(panel);
    return panel;
  });
  let disposed = false, timer, navigating = false, userScroll = false, pointerStart;
  let hour = scrollTop;
  function fill(panel, value) {
    if (disposed) return;
    renderTimeline(panel,value,openRecord);
    const clock = panel.querySelector('.history-clock-scroll');
    if (!clock.classList.contains('as-agenda')) clock.scrollTop = hour;
    clock.addEventListener('scroll', () => {
      if (clock.classList.contains('as-agenda')) return;
      hour = clock.scrollTop;
      panels.forEach(other => {
        const otherClock = other.querySelector('.history-clock-scroll:not(.as-agenda)');
        if (otherClock && Math.abs(otherClock.scrollTop-hour)>1) otherClock.scrollTop=hour;
      });
    }, {passive:true});
  }
  container.replaceChildren(pager);
  fill(panels[1],data);
  const center = () => { if (!disposed) pager.scrollLeft = pager.clientWidth; };
  let width=pager.clientWidth;
  const observer = new ResizeObserver(() => { if(pager.clientWidth!==width){width=pager.clientWidth;center();} });
  observer.observe(pager); center();
  for (const index of [0,2]) {
    panels[index].innerHTML='<p class="history-week-empty">Loading week…</p>';
    loadWeek(nextDay(week,(index-1)*7)).then(value=>fill(panels[index],value)).catch(()=>{
      if (!disposed) panels[index].innerHTML='<p class="history-week-empty">Scroll here to retry loading this week.</p>';
    });
  }
  function navigate(offset) {
    if (navigating || disposed || !offset) return;
    navigating=true;
    onNavigate(offset*7,hour);
  }
  pager.addEventListener('wheel', event => {
    if(Math.abs(event.deltaX)>Math.abs(event.deltaY) || event.shiftKey) userScroll=true;
  }, {passive:true});
  pager.addEventListener('pointerdown', event => {
    pointerStart={x:event.clientX,y:event.clientY};
    if(event.target===pager) userScroll=true; // scrollbar
  }, {passive:true});
  pager.addEventListener('pointermove', event => {
    if(pointerStart && Math.abs(event.clientX-pointerStart.x)>12 && Math.abs(event.clientX-pointerStart.x)>Math.abs(event.clientY-pointerStart.y))userScroll=true;
  }, {passive:true});
  pager.addEventListener('pointerup',()=>{pointerStart=null;});
  pager.addEventListener('touchstart',event=>{pointerStart={x:event.touches[0].clientX,y:event.touches[0].clientY};},{passive:true});
  pager.addEventListener('touchmove',event=>{
    const point=event.touches[0];
    if(pointerStart && Math.abs(point.clientX-pointerStart.x)>12 && Math.abs(point.clientX-pointerStart.x)>Math.abs(point.clientY-pointerStart.y))userScroll=true;
  },{passive:true});
  pager.addEventListener('touchend',()=>{pointerStart=null;},{passive:true});
  pager.addEventListener('scroll', () => {
    clearTimeout(timer);
    timer=setTimeout(()=>{
      const offset=Math.round(pager.scrollLeft/pager.clientWidth)-1;
      if (Math.abs(pager.scrollLeft-(offset+1)*pager.clientWidth)<4) {
        if(userScroll) navigate(offset); else if(offset) center();
        if(!offset) userScroll=false;
      }
    },160);
  }, {passive:true});
  pager.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight'].includes(event.key) || event.target.closest('button,input,textarea,select')) return;
    event.preventDefault(); navigate(event.key==='ArrowLeft' ? -1 : 1);
  });
  return () => { disposed=true; clearTimeout(timer); observer.disconnect(); };
}
