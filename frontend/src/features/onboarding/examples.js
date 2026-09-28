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
