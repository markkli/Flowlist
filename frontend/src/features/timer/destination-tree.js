import {api} from '../../shared/api';
import {escapeHtml} from '../../shared/dom';
import './destination-tree.css';

export function initDestinationTree(root) {
  let selected={kind:'standalone',label:'Standalone task'},busy=false,generation=0;
  root.innerHTML=`<span class="destination-label" id="destination-label">Where should it go?</span><div class="destination-tree" role="group" aria-labelledby="destination-label"></div><div class="destination-create"></div><div class="destination-new" hidden><label for="capture-project-name">Project name</label><input id="capture-project-name" class="field" maxlength="120" placeholder="New project name"></div><p class="destination-path" role="status"></p><p class="destination-status" role="status"></p><button class="text-btn destination-retry hidden" type="button">Reload projects</button>`;
  const tree=root.querySelector('.destination-tree'),name=root.querySelector('input'),newField=root.querySelector('.destination-new'),status=root.querySelector('.destination-status'),retry=root.querySelector('.destination-retry');
  const sync=()=>{newField.hidden=selected.kind!=='new';name.required=selected.kind==='new';root.querySelector('.destination-path').textContent=`Destination: ${selected.label}`;};
  function choice(container,label,value,description='') {
    const item=document.createElement('label');item.className='destination-choice';
    item.innerHTML=`<input type="radio" name="capture-destination"><span><strong>${escapeHtml(label)}</strong>${description?`<small>${escapeHtml(description)}</small>`:''}</span>`;
    const input=item.querySelector('input');input.checked=value.kind==='standalone';input.disabled=busy;
    input.addEventListener('change',()=>{selected=value;sync();if(value.kind==='new')name.focus();});container.append(item);
  }
  function render(goals=[]) {
    selected={kind:'standalone',label:'Standalone task'};tree.replaceChildren();root.querySelector('.destination-create').replaceChildren();
    choice(tree,'Standalone task',selected);
    for(const goal of goals.filter(goal=>goal.goal_type!=='standalone'&&!goal.completed)) {
      const branch=document.createElement('details');branch.className='destination-project';
      branch.innerHTML=`<summary>${escapeHtml(goal.title)}</summary><div class="destination-children"></div>`;
      const children=branch.lastElementChild;
      choice(children,'Directly in this project',{kind:'project',goalId:goal.id,label:goal.title});
      const tasks=goal.tasks||[];
      for(const task of tasks.filter(task=>task.parent_id==null && task.depth<2)) {
        const node=document.createElement('div');node.className='destination-task';
        choice(node,task.title,{kind:'subtask',parentId:task.id,label:`${goal.title} → ${task.title}`},'Add a subtask');
        const descendants=tasks.filter(child=>child.parent_id===task.id);
        if(descendants.length){const list=document.createElement('ul');list.className='destination-leaves';list.setAttribute('aria-label',`Existing subtasks of ${task.title}`);descendants.forEach(child=>{const li=document.createElement('li');li.textContent=child.title;list.append(li);});node.append(list);}
        children.append(node);
      }
      tree.append(branch);
    }
    choice(root.querySelector('.destination-create'),'New project…',{kind:'new',label:'New project'});sync();
  }
  async function load() {
    const request=++generation;name.value='';render();status.textContent='Loading projects…';retry.classList.add('hidden');
    try{const goals=await api('/goals?include_tasks=true');if(request!==generation)return;render(goals);status.textContent='';}
    catch(error){if(request!==generation)return;status.textContent='Projects could not load. Retry, or create a standalone task.';retry.classList.remove('hidden');}
  }
  retry.addEventListener('click',()=>{if(!busy)load();});
  return {load, cancel(){generation++;},getSelection(){return {...selected,projectTitle:name.value.trim()};},setDisabled(value){busy=value;root.querySelectorAll('input,button').forEach(control=>control.disabled=value);}};
}
