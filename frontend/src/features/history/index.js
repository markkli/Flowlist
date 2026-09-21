import { api, timezoneQuery } from '../../shared/api';
import { escapeHtml, trapFocus, syncDialogs } from '../../shared/dom';
import { asDate, dayKey, monday, nextDay, rangeLabel, duration, renderTimeline } from './timeline';
import './history.css';

export function initHistory({ showToast, refresh }) {
  const el = id => document.getElementById(id);
  const history=el('history-view'), more=el('history-more'), deletedToggle=el('history-deleted');
  const overlay=el('history-detail-overlay'), modal=overlay.querySelector('section'), form=el('history-edit-form');
  let mode='week', week=monday(), cursor=null, deleted=false, loading=false, generation=0;
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
    if(!rows.length) { const empty=document.createElement('p');empty.textContent='General focus · no tasks attached.';target.appendChild(empty); }
    rows.forEach(row=>{
      const item=document.createElement('div');item.className='history-edit-row';
      item.innerHTML=`<label class="history-work-choice"><input type="checkbox" class="history-include" ${row.included?'checked':''}><span><strong>${escapeHtml(row.task_title)}</strong><small>${escapeHtml(row.goal_title || 'Tasks')}${row.task_id == null ? ' · removed from Plan' : ''}</small></span></label><label class="history-finish-choice"><input type="checkbox" class="history-finished" ${row.completed?'checked':''} ${row.included?'':'disabled'}><span>Finished</span></label>`;
      const include=item.querySelector('.history-include'), finished=item.querySelector('.history-finished');
      include.setAttribute('aria-label',`Worked on ${row.task_title}`);finished.setAttribute('aria-label',`Finished ${row.task_title}`);
      include.addEventListener('change',()=>{row.included=include.checked;finished.disabled=!include.checked;});
      finished.addEventListener('change',()=>{row.completed=finished.checked;});target.appendChild(item);
    });
  }
  function renderTaskResults() {
    const search=el('history-task-search').value.trim().toLocaleLowerCase();
    const available=(taskOptions || []).filter(task=>!rows.some(row=>row.task_id===task.id) && `${task.title} ${task.goal_title}`.toLocaleLowerCase().includes(search));
    const target=el('history-task-results');target.replaceChildren();
    el('history-task-status').textContent=available.length>40 ? `${available.length} matches. Showing 40; type to narrow the list.` : `${available.length} ${available.length===1?'task':'tasks'} available`;
    available.slice(0,40).forEach(task=>{
      const button=document.createElement('button');button.type='button';button.className='history-task-option';
      button.innerHTML=`<span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.goal_title)}${task.completed ? ' · completed in Plan' : ''}</small></span><span aria-hidden="true">+</span>`;
      button.setAttribute('aria-label',`Add ${task.title} to record`);
      button.addEventListener('click',()=>{ rows.push({task_id:task.id,task_title:task.title,goal_title:task.goal_title,included:true,completed:false});renderRows();renderTaskResults();el('history-edit-attributions').querySelectorAll('input.history-include').item(rows.length-1)?.focus(); });
      target.appendChild(button);
    });
  }
  function openRecord(session, source) {
    record=session;opener=source;taskOptions=null;detailGeneration++;
    rows=session.attributions.map(row=>({...row,attribution_id:row.id,included:true}));
    el('history-detail-title').textContent=session.task_title;
    el('history-detail-meta').textContent=`${session.actual_minutes} minutes focused · ${session.started_at ? asDate(session.started_at).toLocaleString() : `Saved ${asDate(session.created_at).toLocaleString()}`}`;
    const blocks=el('history-detail-blocks');blocks.replaceChildren();
    if(session.started_at && session.blocks?.length) {
      const list=document.createElement('ul');list.className='history-block-list';
      session.blocks.forEach(block=>{const item=document.createElement('li');const start=asDate(block.started_at),end=asDate(block.ended_at);item.textContent=`${start.toLocaleDateString([], {month:'short',day:'numeric'})} · ${rangeLabel(start,end)} · ${duration(Math.round((end-start)/1000))}`;list.appendChild(item);});blocks.appendChild(list);
      const note=document.createElement('p');note.textContent='Notes and tasks belong to the whole ritual, not an individual block.';blocks.appendChild(note);
    } else blocks.textContent=session.started_at ? 'No focused time was recorded.' : 'Block times were not recorded for this older ritual.';
    el('history-reflection').value=session.summary || '';el('history-edit-error').textContent='';el('history-reload-record').classList.add('hidden');
    el('history-add-work').open=false;el('history-task-search').value='';el('history-task-results').replaceChildren();
    renderRows();original=serialize();overlay.classList.remove('hidden');syncDialogs();modal.focus();
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
  async function loadHistory(append=false) {
    if(append && loading) return;
    const request=++generation;loading=true;more.disabled=true;el('history-error').textContent='';
    el('history-week').classList.toggle('hidden',mode!=='week');history.classList.toggle('hidden',mode!=='list');
    el('history-week-tab').setAttribute('aria-pressed',String(mode==='week'));el('history-list-tab').setAttribute('aria-pressed',String(mode==='list'));
    deletedToggle.setAttribute('aria-pressed',String(deleted));deletedToggle.textContent=deleted?'Show saved records':'Show deleted records';
    more.classList.add('hidden');
    try {
      if(mode==='week') {
        const data=await api(`/history/week?start=${dayKey(week)}&${timezoneQuery()}`);if(request!==generation)return;
        const last=nextDay(week,6);
        el('history-week-label').textContent=`${week.toLocaleDateString([], {month:'short',day:'numeric'})} – ${last.toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'})}`;
        el('history-week-total').textContent=`${data.days.reduce((total,day)=>total+day.minutes,0)} min focused · ${data.sessions.length} ${data.sessions.length===1?'ritual':'rituals'}`;
        el('history-timezone').textContent=`${Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_',' ')} · 24-hour week · Scroll to see all hours. Breaks excluded; sessions under 5 minutes appear in Brief sessions. Select a block to review its ritual.`;
        renderTimeline(el('history-timeline'),data,openRecord);
        const untimed=data.sessions.filter(session=>!session.started_at || !session.blocks?.length);
        el('history-untimed').classList.toggle('hidden',!untimed.length);el('history-untimed-list').replaceChildren(...untimed.map(session=>recordCard(session)));
      } else {
        const sessions=await api(`/sessions?limit=30&deleted=${deleted}${append&&cursor?`&before_id=${cursor}`:''}`);if(request!==generation)return;
        if(!append)history.replaceChildren();sessions.forEach(session=>history.appendChild(recordCard(session,deleted)));
        cursor=sessions.at(-1)?.id ?? null;more.classList.toggle('hidden',sessions.length<30);
        if(!history.children.length){const empty=document.createElement('p');empty.className='page-description';empty.textContent=deleted?'No deleted records.':'No focus rituals saved yet.';history.appendChild(empty);}
      }
    } finally {if(request===generation){loading=false;more.disabled=false;}}
  }
  more.addEventListener('click',()=>run(()=>loadHistory(true)));
  el('history-week-tab').addEventListener('click',()=>run(()=>{mode='week';deleted=false;return loadHistory();}));
  el('history-list-tab').addEventListener('click',()=>run(()=>{mode='list';deleted=false;return loadHistory();}));
  deletedToggle.addEventListener('click',()=>run(()=>{mode='list';deleted=!deleted;return loadHistory();}));
  [['history-prev',-7],['history-next',7],['history-current',0]].forEach(([id,days])=>el(id).addEventListener('click',()=>run(()=>{week=days?nextDay(week,days):monday();return loadHistory();})));
  ['history-detail-close','history-edit-cancel'].forEach(id=>el(id).addEventListener('click',()=>closeRecord()));
  el('history-task-search').addEventListener('input',renderTaskResults);
  el('history-add-work').addEventListener('toggle',async()=>{
    if(!el('history-add-work').open || taskOptions)return;
    const version=detailGeneration;el('history-task-status').textContent='Loading tasks…';
    try {const tasks=await api('/history/task-options');if(version!==detailGeneration)return;taskOptions=tasks;renderTaskResults();}
    catch(error){if(version===detailGeneration)el('history-task-status').textContent=`${error.message} Close and reopen this section to retry.`;}
  });
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
  return {loadHistory,handleKey(event){if(overlay.classList.contains('hidden'))return false;if(event.key==='Escape'){event.preventDefault();closeRecord();}else trapFocus(event,modal);return true;}};
}
