// Detached copies of app markup: these examples never use Plan or timer handlers.
export function createPriorityExample(stage) {
  stage.innerHTML='<p class="guide-example-label">Example · nothing is saved</p><h2 class="guide-example-title">Learn something new</h2>';
  const row=document.getElementById('task-template').content.querySelector('.task-row').cloneNode(true);
  row.querySelectorAll('.task-chevron,.task-reorder-handle,.task-more,.task-menu,.task-progress').forEach(node=>node.remove());
  const title=row.querySelector('.task-title');
  const text=document.createElement('span');text.className=title.className;text.textContent='Read the first chapter';title.replaceWith(text);
  row.querySelector('.task-completed').disabled=true;
  const star=row.querySelector('.task-priority');star.id='guide-example-star';star.setAttribute('aria-label','Prioritize example task');
  const feedback=document.createElement('p');feedback.className='guide-example-feedback';feedback.setAttribute('role','status');feedback.textContent='Try the star.';
  star.addEventListener('click',()=>{
    const selected=star.getAttribute('aria-pressed')!=='true';star.setAttribute('aria-pressed',String(selected));
    feedback.textContent=selected?'This task would appear in Priority tasks on Today.':'Priority removed. The task stays in Plan.';
  });stage.append(row,feedback);
}

export function createReviewExample(stage,onSave) {
  stage.innerHTML='<p class="guide-example-label">Example · nothing is saved</p>';
  const modal=document.querySelector('#session-attribution-overlay .attribution-modal').cloneNode(true);
  // Namespaced IDs and references avoid duplicating the actual form's controls.
  const renamed=new Map();modal.querySelectorAll('[id]').forEach(node=>renamed.set(node.id,`guide-demo-${node.id}`));
  modal.querySelectorAll('*').forEach(node=>{
    for(const attr of ['for','aria-labelledby','aria-describedby','aria-controls'])if(node.hasAttribute(attr))node.setAttribute(attr,node.getAttribute(attr).split(' ').map(id=>renamed.get(id)||id).join(' '));
    if(node.id)node.id=renamed.get(node.id);
  });
  modal.classList.add('guide-review-example');modal.removeAttribute('tabindex');
  modal.querySelector('#guide-demo-attribution-status').textContent='Session complete';
  modal.querySelector('#guide-demo-attribution-minutes').textContent='25 min of focus';
  const note=modal.querySelector('textarea');note.value='';note.placeholder='e.g. Read chapter one and tried an exercise';note.disabled=false;
  const options=modal.querySelector('.attribution-options');
  options.innerHTML='<div class="attribution-task-row" id="guide-example-progress"><div class="attribution-task-copy"><strong>Read the first chapter</strong></div></div>';
  const row=options.firstElementChild;
  for(const [key,label] of [['worked','Worked on'],['finished','Finished']]) {
    const control=document.createElement('label');control.className=`attribution-toggle attribution-${key}`;
    control.innerHTML=`<input class="attribution-${key}-input" type="checkbox" aria-label="${label} example task"><span class="toggle-box"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 8.5 2.5 2.5L12 5.5"/></svg></span><span>${label}</span>`;
    row.append(control);
  }
  const worked=row.querySelector('.attribution-worked-input'),finished=row.querySelector('.attribution-finished-input');
  worked.addEventListener('change',()=>{if(!worked.checked)finished.checked=false;});
  finished.addEventListener('change',()=>{if(finished.checked)worked.checked=true;});
  modal.querySelectorAll('.sr-only,.field-error').forEach(node=>node.remove());
  modal.querySelectorAll('.attribution-summary,.attribution-general-note').forEach(node=>node.hidden=false);
  modal.querySelectorAll('button').forEach(button=>{button.disabled=false;button.type='button';});
  modal.querySelector('#guide-demo-save-session').textContent='Save session';
  modal.querySelector('#guide-demo-save-session').addEventListener('click',onSave);
  modal.querySelectorAll('#guide-demo-attribution-later,#guide-demo-discard-session').forEach(button=>button.disabled=true);
  modal.querySelector('form').addEventListener('submit',event=>event.preventDefault());
  stage.append(modal);
}
