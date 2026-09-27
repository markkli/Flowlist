import { dayKey, monday, nextDay, renderCalendarDay, segmentsFor } from './timeline';

// One native two-axis scroller. Dates are appended/prepended at its edges,
// preserving both the scroll element and fractional position during gestures.
export function createCalendar(container, initialWeek, initialData, {loadWeek, openRecord, onWeekChange, scrollTop=480}) {
  const scroll=document.createElement('div');scroll.className='history-calendar-scroll';
  scroll.tabIndex=0;scroll.setAttribute('role','region');
  scroll.setAttribute('aria-label','Focus calendar. Scroll horizontally through dates and vertically through hours. Arrow keys move one day.');
  const grid=document.createElement('div');grid.className='history-calendar-grid';
  const axis=document.createElement('div');axis.className='history-time-axis';axis.setAttribute('aria-hidden','true');
  axis.innerHTML='<div class="history-axis-heading"><span title="Sessions under five minutes">Brief</span></div>';
  for(let h=0;h<24;h++) {
    const label=document.createElement('span');label.textContent=`${String(h).padStart(2,'0')}:00`;label.style.top=`${108+h*60}px`;axis.append(label);
  }
  grid.append(axis);scroll.append(grid);container.replaceChildren(scroll);
  let disposed=false, frame, activeKey='', start=nextDay(initialWeek,-14), dayWidth=120;
  const weeks=new Map();
  let ordered=[];
  function sizes(){dayWidth=Math.max(112,(scroll.clientWidth-48)/7);grid.style.setProperty('--day-width',`${dayWidth}px`);grid.style.setProperty('--day-count',String(ordered.length*7));}
  function dateAtLeft(){return nextDay(start,Math.max(0,Math.floor((scroll.scrollLeft+1)/dayWidth)));}
  function report(force=false) {
    const selected=monday(dateAtLeft()), key=dayKey(selected), entry=weeks.get(key);
    if(force || key!==activeKey){activeKey=key;onWeekChange(selected,entry?.data,scroll.scrollTop,entry?.error);}
  }
  function fill(entry,data,options={}) {
    const days=Array.from({length:7},(_,i)=>{
      const key=dayKey(nextDay(entry.date,i));return data?.days.find(day=>day.date===key) || {date:key,minutes:0,seconds:0};
    });
    const segments=segmentsFor(data?.sessions || [],days.map(day=>day.date));
    entry.nodes=days.map((day,i)=>{
      const node=renderCalendarDay(day,segments.filter(item=>item.date===day.date),openRecord,options);
      entry.nodes[i].replaceWith(node);return node;
    });
  }
  async function fetchEntry(entry) {
    if(entry.pending || disposed)return;
    entry.pending=true;entry.error=null;fill(entry,null,{loading:true});
    try {
      const data=await loadWeek(entry.date);
      if(disposed || weeks.get(dayKey(entry.date))!==entry)return;
      entry.data=data;fill(entry,data);
    } catch(error) {
      if(disposed || weeks.get(dayKey(entry.date))!==entry)return;
      entry.error=error.message;fill(entry,null,{retry:()=>fetchEntry(entry)});
    } finally {
      entry.pending=false;
      if(!disposed && dayKey(entry.date)===activeKey)report(true);
    }
  }
  function add(date,prepend=false,data=null) {
    const entry={date,nodes:[],data,pending:false,error:null};
    const fragment=document.createDocumentFragment();
    for(let i=0;i<7;i++){const node=document.createElement('section');entry.nodes.push(node);fragment.append(node);}
    if(prepend){grid.insertBefore(fragment,axis.nextSibling);ordered.unshift(entry);start=date;}
    else {grid.append(fragment);ordered.push(entry);}
    weeks.set(dayKey(date),entry);sizes();
    if(data)fill(entry,data);else fetchEntry(entry);
  }
  for(let i=-2;i<=2;i++)add(nextDay(initialWeek,i*7),false,i===0?initialData:null);
  sizes();scroll.scrollLeft=14*dayWidth;scroll.scrollTop=scrollTop;report(true);
  function trim(fromStart) {
    const entry=fromStart?ordered[0]:ordered.at(-1);
    if(entry.nodes.some(node=>node.contains(document.activeElement)))scroll.focus({preventScroll:true});
    entry.nodes.forEach(node=>node.remove());weeks.delete(dayKey(entry.date));
    if(fromStart){ordered.shift();start=ordered[0].date;scroll.scrollLeft-=7*dayWidth;}else ordered.pop();
    sizes();
  }
  function extend() {
    if(disposed)return;
    if(scroll.scrollLeft<7*dayWidth) {
      const left=scroll.scrollLeft;add(nextDay(start,-7),true);scroll.scrollLeft=left+7*dayWidth;
      if(ordered.length>13)trim(false);
    } else if(scroll.scrollWidth-scroll.clientWidth-scroll.scrollLeft<7*dayWidth) {
      add(nextDay(ordered.at(-1).date,7));if(ordered.length>13)trim(true);
    }
    report();
  }
  scroll.addEventListener('scroll',()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(extend);},{passive:true});
  scroll.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight'].includes(event.key)||event.target.closest('button,summary,input,textarea,select'))return;
    event.preventDefault();scroll.scrollLeft+=(event.key==='ArrowLeft'?-1:1)*dayWidth;
  });
  scroll.addEventListener('pointerdown',event=>grid.querySelectorAll('details[open]').forEach(details=>{if(!details.contains(event.target))details.open=false;}));
  scroll.addEventListener('keydown',event=>{if(event.key==='Escape')grid.querySelectorAll('details[open]').forEach(details=>{details.open=false;details.querySelector('summary').focus();});});
  let width=scroll.clientWidth;
  const observer=new ResizeObserver(()=>{
    if(disposed || width===scroll.clientWidth)return;
    const position=scroll.scrollLeft/dayWidth; width=scroll.clientWidth;sizes();scroll.scrollLeft=position*dayWidth;
  });observer.observe(scroll);
  return {
    dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();},
    get scrollTop(){return scroll.scrollTop;},
    goTo(date){
      const key=dayKey(monday(date)),entry=weeks.get(key);
      if(!entry)return false;
      scroll.scrollLeft=ordered.indexOf(entry)*7*dayWidth;report(true);return true;
    },
  };
}
