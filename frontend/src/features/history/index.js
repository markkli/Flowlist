import { api, timezoneQuery } from '../../shared/api';
import { escapeHtml, trapFocus, syncDialogs } from '../../shared/dom';
import { asDate, dayKey, nextDay, rangeLabel, duration } from './timeline';
import './history.css';
import '../timer/attribution.css';
import { workRowContent, groupWorkRows } from '../../shared/work-row';
import { createCalendar } from './calendar';

export function initHistory({ showToast, refresh }) {
  const el = id => document.getElementById(id);
  const history=el('history-view'), more=el('history-more'), deletedToggle=el('history-deleted');
  const overlay=el('history-detail-overlay'), modal=overlay.querySelector('section'), form=el('history-edit-form');
  const trailingStart=(date=new Date())=>new Date(date.getFullYear(),date.getMonth(),date.getDate()-6,12);
  let mode='week', week=trailingStart(), cursor=null, deleted=false, loading=false, generation=0;
  let weekCache=new Map(), calendar=null, calendarScrollTop=480;
  function loadWeek(date) {
    const key=dayKey(date), cache=weekCache;
    if (!cache.has(key)) {
      if (cache.size > 8) cache.delete(cache.keys().next().value);
      const request=api(`/history/week?start=${key}&${timezoneQuery()}`).catch(error=>{cache.delete(key);throw error;});
      cache.set(key,request);
    }
    return cache.get(key);
  }
  async function moveWeek(days, hour=calendarScrollTop) {
    calendarScrollTop=calendar?.scrollTop ?? hour;
    const previous=week;
    if(!days) weekCache=new Map();
    week=days?nextDay(week,days):trailingStart();
    try { await loadHistory(false,true); } catch(error) { week=previous; await loadHistory(false,true); throw error; }
  }
  let record=null, rows=[], original='', opener=null, saving=false, taskOptions=null, detailGeneration=0;
  const run = action => Promise.resolve().then(action).catch(error=>{el('history-error').textContent=error.message;});
  const serialize = () => JSON.stringify({summary:el('history-reflection').value, attributions:rows.filter(row=>row.included).map(row=>({...(row.attribution_id ? {attribution_id:row.attribution_id} : {task_id:row.task_id}),completed:row.completed}))});
  function closeRecord(force=false) {
    if(saving || (!force && original!==serialize() && !window.confirm('Close without saving these changes?'))) return;
    overlay.classList.add('hidden'); detailGeneration++; syncDialogs();
    (opener?.isConnected ? opener : el('history-list-tab')).focus();
  }
  function renderRows() {
    const target=el('history-edit-attributions');target.replaceChildren();
    const search=el('history-task-search').value.trim().toLocaleLowerCase();
    const byId=new Map(rows.filter(row=>row.task_id!=null).map(row=>[row.task_id,row]));
    const parentOf=row=>byId.get(row.parent_id);
    const visible=rows.filter(row=>`${row.task_title} ${row.goal_title} ${parentOf(row)?.task_title||''}`.toLocaleLowerCase().includes(search));
    if(!visible.length) { const empty=document.createElement('p');empty.className='attribution-empty';empty.textContent=search?'No matching tasks.':taskOptions?'No tasks to attach. Your time and note are still saved.':'General focus · no tasks attached.';target.appendChild(empty); }
    const groups=new Map();
    visible.forEach(row=>{const key=row.goal_title||'Tasks';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);});
    let groupIndex=0;
    for(const [name,group] of groups) {
      const section=document.createElement('section');section.className='attribution-group';
      const headingId=`history-work-group-${groupIndex++}`;section.setAttribute('aria-labelledby',headingId);
      section.innerHTML=`<header class="attribution-group-heading"><h3 id="${headingId}">${escapeHtml(name)}</h3></header><div class="attribution-group-tasks"></div>`;
      const list=section.lastElementChild,visited=new Set();
      const append=row=>{
        if(visited.has(row))return;visited.add(row);
        const parent=parentOf(row);
        const context=[parent?`Subtask of ${parent.task_title}`:row.parent_id!=null?'Subtask':'',row.task_id==null?'Removed from Plan':row.plan_completed?'Completed in Plan':''].filter(Boolean).join(' · ');
        const item=document.createElement('div');item.className=`attribution-task-row${row.parent_id!=null?' is-subtask':''}`;
        if(row.task_id!=null)item.dataset.taskId=row.task_id;
        if(row.parent_id!=null)item.dataset.parentId=row.parent_id;
        const contextId=`history-work-context-${groupIndex}-${visited.size}`;
        item.innerHTML=workRowContent({title:row.task_title,context,contextId,describedBy:`history-choice-help ${headingId}${context?' '+contextId:''}`});
        const include=item.querySelector('.attribution-worked-input'),finished=item.querySelector('.attribution-finished-input');
        const sync=()=>{include.checked=row.included;finished.checked=row.included&&row.completed;item.classList.toggle('selected',row.included);item.classList.toggle('finished',row.included&&row.completed);};
        include.addEventListener('change',()=>{row.included=include.checked;if(!row.included)row.completed=false;sync();});
        finished.addEventListener('change',()=>{row.completed=finished.checked;if(row.completed)row.included=true;sync();});
        sync();list.appendChild(item);
        if(row.task_id!=null)group.filter(child=>child.parent_id===row.task_id).forEach(append);
      };
      group.filter(row=>!group.some(parent=>parent.task_id!=null&&parent.task_id===row.parent_id)).forEach(append);
      group.forEach(append);groupWorkRows(list);target.appendChild(section);
    }
  }
  async function loadTaskOptions() {
    const version=detailGeneration;el('history-task-status').textContent='Loading tasks…';el('history-tasks-retry').classList.add('hidden');
    try {
      const tasks=await api('/history/task-options');if(version!==detailGeneration)return;taskOptions=tasks;
      for(const task of tasks) {
        let row=rows.find(row=>row.task_id===task.id);
        if(!row){row={task_id:task.id,task_title:task.title,goal_title:task.goal_title,included:false,completed:false};rows.push(row);}
        row.parent_id=task.parent_id;row.plan_completed=task.completed;
      }
      el('history-task-status').textContent='';if(!saving)renderRows();
    } catch(error) {if(version===detailGeneration){el('history-task-status').textContent='Could not load Plan tasks. Your recorded tasks are still available.';el('history-tasks-retry').classList.remove('hidden');}}
  }
  function openRecord(session, source) {
    record=session;opener=source;taskOptions=null;detailGeneration++;
    rows=session.attributions.map(row=>({...row,attribution_id:row.id,included:true}));
    el('history-detail-title').textContent=session.task_title;
    const seconds=session.blocks?.reduce((sum,block)=>sum+Math.max(0,(asDate(block.ended_at)-asDate(block.started_at))/1000),0);
    el('history-detail-meta').textContent=`${duration(Math.round(seconds || session.actual_minutes*60))} focused · ${asDate(session.started_at || session.created_at).toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'})}`;
    const blocks=el('history-detail-blocks');blocks.replaceChildren();
    if(session.started_at && session.blocks?.length) {
      const list=document.createElement('ul');list.className='history-block-list';
      session.blocks.forEach(block=>{const item=document.createElement('li');const start=asDate(block.started_at),end=asDate(block.ended_at);item.textContent=`${start.toLocaleDateString([], {month:'short',day:'numeric'})} · ${rangeLabel(start,end)} · ${duration(Math.round((end-start)/1000))}`;list.appendChild(item);});
      if(session.blocks.length>1){const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=`${session.blocks.length} focus intervals`;details.append(summary,list);blocks.appendChild(details);}else blocks.appendChild(list);
      if(session.blocks.length>1){const note=document.createElement('p');note.textContent='Notes and tasks apply to the whole session.';blocks.querySelector('details').appendChild(note);}
    } else blocks.textContent=session.started_at ? 'No focused time was recorded.' : 'Block times were not recorded for this older ritual.';
    el('history-reflection').value=session.summary || '';el('history-edit-error').textContent='';el('history-reload-record').classList.add('hidden');
    el('history-task-search').value='';el('history-task-status').textContent='';
    renderRows();original=serialize();overlay.classList.remove('hidden');syncDialogs();modal.focus();loadTaskOptions();
  }
  function recordCard(session, isDeleted=false) {
    const article=document.createElement('article');article.className='panel session-row history-record';
    article.innerHTML=`<div class="session-copy"><button type="button" class="session-title"></button><p class="session-meta"></p><p class="session-summary-note"></p><div class="session-attributions"></div></div><div class="history-record-actions"><span class="session-status">${isDeleted?'Deleted':'Focus ritual'}</span><button class="text-btn session-delete" type="button"></button></div>`;
    const title=article.querySelector('.session-title');title.textContent=session.task_title;title.disabled=isDeleted;title.addEventListener('click',()=>openRecord(session,title));
    article.querySelector('.session-meta').textContent=`${session.actual_minutes} minutes focused · ${session.started_at ? asDate(session.started_at).toLocaleString() : `Saved ${asDate(session.created_at).toLocaleString()} · block times unavailable`}`;
    const summary=article.querySelector('.session-summary-note');summary.textContent=session.summary || '';summary.hidden=!session.summary;
    const attributions=article.querySelector('.session-attributions');
    session.attributions.forEach(item=>{const label=document.createElement('span');label.textContent=`${item.completed?'Finished':'Worked on'}: ${item.task_title}`;attributions.appendChild(label);});
    if(!session.attributions.length) attributions.textContent='General focus';
    const button=article.querySelector('.session-delete');button.textContent=isDeleted?'Restore':'Delete';button.setAttribute('aria-label',`${button.textContent} ${session.task_title}`);
    button.addEventListener('click',()=>run(async()=>{
      button.disabled=true;
      try {
        await api(`/sessions/${session.id}${isDeleted?'/restore':''}`,{method:isDeleted?'POST':'DELETE'});
        await loadHistory();await refresh();
        showToast(isDeleted?'Focus record restored.':'Focus record deleted.',false,isDeleted?null:{label:'Undo',run:async()=>{await api(`/sessions/${session.id}/restore`,{method:'POST'});await loadHistory();await refresh();}});
      } catch(error) {button.disabled=false;throw error;}
    }));return article;
  }
  function updateWeekSummary(date,data,hour,error) {
    week=date;calendarScrollTop=hour;
    const last=nextDay(week,6);
    el('history-week-label').textContent=`${week.toLocaleDateString([], {month:'short',day:'numeric'})} – ${last.toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'})}`;
    el('history-week-total').textContent=data?`${data.days.reduce((total,day)=>total+day.minutes,0)} min focused · ${data.sessions.length} ${data.sessions.length===1?'session':'sessions'}`:error?'Week unavailable':'Loading…';
    el('history-timezone').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_',' ');
    el('history-error').textContent=error || '';
    const untimed=(data?.sessions || []).filter(session=>!session.started_at || !session.blocks?.length);
    el('history-untimed').classList.toggle('hidden',!untimed.length);el('history-untimed-list').replaceChildren(...untimed.map(session=>recordCard(session)));
  }
  async function loadHistory(append=false, reuseWeek=false) {
    if(append && loading) return;
    if (!reuseWeek) weekCache=new Map();
    calendarScrollTop=calendar?.scrollTop ?? calendarScrollTop;calendar=null;
    const request=++generation;loading=true;more.disabled=true;
    ['history-prev','history-next','history-current'].forEach(id=>el(id).disabled=true);el('history-error').textContent='';
    el('history-week').classList.toggle('hidden',mode!=='week');history.classList.toggle('hidden',mode!=='list');
    el('history-week-tab').setAttribute('aria-pressed',String(mode==='week'));el('history-list-tab').setAttribute('aria-pressed',String(mode==='list'));
    deletedToggle.setAttribute('aria-pressed',String(deleted));deletedToggle.textContent=deleted?'Show saved records':'Show deleted records';
    more.classList.add('hidden');
    try {
      if(mode==='week') {
        const data=await loadWeek(week);if(request!==generation)return;
        const hadCalendarFocus=el('history-timeline').contains(document.activeElement);
        calendar=createCalendar(el('history-timeline'),data,{openRecord,scrollTop:calendarScrollTop});
        updateWeekSummary(week,data,calendarScrollTop);
        if(hadCalendarFocus) el('history-timeline').querySelector('.history-calendar-scroll').focus({preventScroll:true});
      } else {
        const sessions=await api(`/sessions?limit=30&deleted=${deleted}${append&&cursor?`&before_id=${cursor}`:''}`);if(request!==generation)return;
        if(!append)history.replaceChildren();sessions.forEach(session=>history.appendChild(recordCard(session,deleted)));
        cursor=sessions.at(-1)?.id ?? null;more.classList.toggle('hidden',sessions.length<30);
        if(!history.children.length){const empty=document.createElement('p');empty.className='page-description';empty.textContent=deleted?'No deleted records.':'No saved sessions.';history.appendChild(empty);}
      }
    } finally {if(request===generation){loading=false;more.disabled=false;['history-prev','history-next','history-current'].forEach(id=>el(id).disabled=false);}}
  }
  more.addEventListener('click',()=>run(()=>loadHistory(true)));
  el('history-week-tab').addEventListener('click',()=>run(()=>{mode='week';deleted=false;return loadHistory();}));
  el('history-list-tab').addEventListener('click',()=>run(()=>{mode='list';deleted=false;return loadHistory();}));
  deletedToggle.addEventListener('click',()=>run(()=>{mode='list';deleted=!deleted;return loadHistory();}));
  [['history-prev',-7],['history-next',7],['history-current',0]].forEach(([id,days])=>el(id).addEventListener('click',()=>run(()=>{return moveWeek(days);})));
  ['history-detail-close','history-edit-cancel'].forEach(id=>el(id).addEventListener('click',()=>closeRecord()));
  el('history-task-search').addEventListener('input',renderRows);
  el('history-tasks-retry').addEventListener('click',loadTaskOptions);
  el('history-reload-record').addEventListener('click',async()=>{
    if(original!==serialize()&&!window.confirm('Replace your unsaved edits with the saved record?'))return;
    try{const latest=await api(`/sessions/${record.id}`);openRecord(latest,opener);}catch(error){el('history-edit-error').textContent=error.message;}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(saving)return;saving=true;el('history-edit-error').textContent='';
    form.querySelectorAll('input,textarea,button').forEach(control=>control.disabled=true);el('history-edit-save').textContent='Saving…';
    try {
      const updated=await api(`/sessions/${record.id}`,{method:'PATCH',body:JSON.stringify({revision:record.revision,...JSON.parse(serialize())})});
      saving=false;record=updated;original=serialize();closeRecord(true);showToast('Focus record updated. Plan tasks were not changed.');
      await run(async()=>{await loadHistory();await refresh();});
    }catch(error){el('history-edit-error').textContent=error.message;el('history-reload-record').classList.toggle('hidden',error.status!==409);}
    finally {saving=false;form.querySelectorAll('input,textarea,button').forEach(control=>control.disabled=false);el('history-edit-save').textContent='Save changes';renderRows();}
  });
  el('history-export').addEventListener('click',()=>run(async()=>{
    const button=el('history-export');button.disabled=true;button.textContent='Exporting…';
    try {const data=await api('/export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`flowlist-${dayKey(new Date())}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('Export downloaded: Plan, queue, and saved history, including deleted records.');}
    finally{button.disabled=false;button.textContent='Export data';}
  }));
  return {loadHistory,setWeek(date){week=trailingStart(new Date(`${date}T12:00:00`));},handleKey(event){if(overlay.classList.contains('hidden'))return false;if(event.key==='Escape'){event.preventDefault();closeRecord();}else trapFocus(event,modal);return true;}};
}
