import { nativeCall, nativeState, onNativeState } from '../../shared/native';
import { asDate, duration } from './timeline';

/** Offline saves stay visible until the native outbox confirms their upload. */
export function initPendingRecords({showToast}) {
  const section=document.createElement('section');
  section.className='native-pending-records';section.setAttribute('aria-label','Sessions waiting to sync');
  document.querySelector('#view-history .history-toolbar').before(section);
  let last='',busy=false;
  const action=async(name,id)=>{
    if(busy)return;
    if(name==='general'&&!window.confirm('Save this session as General focus? Its task links will be removed. Your time and note stay.'))return;
    busy=true;section.querySelectorAll('button').forEach(button=>button.disabled=true);
    try {await nativeCall('outbox',{action:name,...(id?{id}:{})});}
    catch(error){showToast(error.message,true);}
    finally{busy=false;section.querySelectorAll('button').forEach(button=>button.disabled=false);}
  };
  const render=state=>{
    const records=state?.pendingRecords || [],key=JSON.stringify(records);
    if(key===last)return;last=key;
    section.hidden=!records.length;section.replaceChildren();
    if(!records.length)return;
    const heading=document.createElement('header');heading.className='panel-heading';
    const title=document.createElement('h2');title.textContent='Waiting to sync';
    const retry=document.createElement('button');retry.type='button';retry.className='secondary-btn';retry.textContent='Retry sync';retry.disabled=busy;
    retry.onclick=()=>action('retry');heading.append(title,retry);section.append(heading);
    for(const record of records) {
      const row=document.createElement('article');row.className='panel session-row history-record';
      const copy=document.createElement('div');copy.className='session-copy';
      const name=document.createElement('strong');name.textContent=record.title;
      const meta=document.createElement('p');meta.className='session-meta';
      meta.textContent=`${duration(record.seconds)} · ${asDate(record.endedAt).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} · Saved on this Mac`;
      copy.append(name,meta);
      if(record.note) {const note=document.createElement('p');note.className='session-summary-note';note.textContent=record.note;copy.append(note);}
      if(record.error) {const error=document.createElement('p');error.className='field-error';error.textContent=record.error;copy.append(error);}
      row.append(copy);
      if([404,422].includes(record.errorCode)) {
        const general=document.createElement('button');general.type='button';general.className='secondary-btn';general.textContent='Save as General focus';general.disabled=busy;
        general.onclick=()=>action('general',record.id);row.append(general);
      }
      section.append(row);
    }
  };
  onNativeState(render);render(nativeState());
}
