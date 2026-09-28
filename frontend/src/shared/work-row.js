import { escapeHtml } from './dom';

// The same two explicit outcomes are used at checkout and in saved records.
export function workRowContent({title,context='',contextId='',describedBy=''}) {
  const copy=`<div class="attribution-task-copy"><strong>${escapeHtml(title)}</strong>${context?`<small${contextId?` id="${escapeHtml(contextId)}"`:''}>${escapeHtml(context)}</small>`:''}</div>`;
  return copy+[['worked','Worked on'],['finished','Finished']].map(([key,label])=>
    `<label class="attribution-toggle attribution-${key}"><input class="attribution-${key}-input" type="checkbox" aria-label="${label} ${escapeHtml(title)}"${describedBy?` aria-describedby="${escapeHtml(describedBy)}"`:''}><span class="toggle-box"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 8.5 2.5 2.5L12 5.5"/></svg></span><span aria-hidden="true">${label}</span></label>`
  ).join('');
}
