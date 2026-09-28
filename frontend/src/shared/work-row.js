import { escapeHtml } from './dom';

// The same two explicit outcomes are used at checkout and in saved records.
export function workRowContent({title,context='',contextId='',describedBy=''}) {
  const copy=`<div class="attribution-task-copy"><strong>${escapeHtml(title)}</strong>${context?`<small${contextId?` id="${escapeHtml(contextId)}"`:''}>${escapeHtml(context)}</small>`:''}</div>`;
  return copy+[['worked','Worked on'],['finished','Finished']].map(([key,label])=>
    `<label class="attribution-toggle attribution-${key}"><input class="attribution-${key}-input" type="checkbox" aria-label="${label} ${escapeHtml(title)}"${describedBy?` aria-describedby="${escapeHtml(describedBy)}"`:''}><span class="toggle-box"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 8.5 2.5 2.5L12 5.5"/></svg></span><span aria-hidden="true">${label}</span></label>`
  ).join('');
}

export function groupWorkRows(list) {
  const rows=[...list.children],byId=new Map(rows.filter(row=>row.dataset.taskId).map(row=>[row.dataset.taskId,row]));
  for(const parent of rows) {
    const children=rows.filter(row=>row.dataset.parentId===parent.dataset.taskId && row!==parent && parent.dataset.taskId);
    if(!children.length || !byId.has(parent.dataset.taskId))continue;
    const branch=document.createElement('div');branch.className='work-branch';parent.before(branch);branch.append(parent);
    const nested=document.createElement('div');nested.className='work-branch-children';branch.append(nested);
    children.forEach(child=>{child.classList.add('in-branch');const context=child.querySelector('.attribution-task-copy small');if(context?.textContent.includes(' · ')){const status=document.createElement('small');status.className='branch-status';status.textContent=context.textContent.split(' · ').slice(1).join(' · ');context.after(status);}nested.append(child);});
  }
}
