import { isNative, nativeState } from '../../shared/native';
import { api } from '../../shared/api';
import { liftPriority } from './live-priority';
import { accountKey, accountLocked } from '../../shared/account';
import { syncDialogs, trapFocus } from '../../shared/dom';
import { readRitual } from '../timer/state';
import { createPriorityExample, createReviewExample } from './examples';
import './onboarding.css';

const VERSION=3;
const steps=[
  {view:'goals',target:'.plan-create-actions',title:'Make a plan',description:'Create a Project for related tasks, or a Task for a quick to-do. Each project task can have one level of subtasks.'},
  {view:'goals',priority:true,title:'Star your priorities',description:'Try the star on your example task. It adds the task to Priority tasks on Today, where you can choose and reorder your shortlist.'},
  {view:'dashboard',target:'#start-pomodoro',title:'Start focusing',description:'Press Start focus whenever you’re ready. You do not need to choose a task first; record what you worked on afterward.'},
  {view:'dashboard',target:'#timer-settings-toggle',title:'Set your rhythm',description:'Adjust focus time, breaks, and rounds here. Chimes mark each transition. Enable desktop notifications for reminders while you’re elsewhere.'},
  {view:'dashboard',example:'review',target:'#guide-demo-session-summary',title:'Leave a note',description:'When you end a session, this review appears. Add an optional note about what you did. You can try the example text box.'},
  {view:'dashboard',example:'review',target:'#guide-example-progress',title:'Worked on or finished?',description:'Worked on logs effort and keeps the task open. Finished checks it off in Plan. Save session records your time and note.'},
  {view:'history',target:'.history-week-navigation',title:'See your progress',description:'Review seven days at a time with the arrows. Today returns to the latest seven. Select a focus block to revisit its notes and tasks.'},
];

export function initOnboarding({preferences={},showToast,prepareExample=()=>{},navigate}) {
  const el=id=>document.getElementById(id), overlay=el('onboarding-overlay'),trigger=el('help-toggle');
  const card=overlay.querySelector('.guide-modal'),spotlight=el('guide-spotlight'),stage=el('guide-example');
  const preview=el('guide-priority-preview'),choice=el('guide-example-choice'),error=el('guide-error'),tabRing=el('guide-tab-highlight');
  let sample=null,live=null,preparing=false,finishing=false,prepareId=0,preparationFailed=false,deferred=false;
  const title=el('onboarding-title'),next=el('onboarding-next'),back=el('onboarding-back'),closeButton=el('onboarding-skip');
  const storageKey=accountKey('flowlist-onboarding-v2'),progressKey=accountKey('flowlist-guide-progress-v3');
  let acknowledged=Number(preferences.version)>0, index=0, required=false, target=null, example='',loadedView='',returnFocus=trigger,frame,renderId=0;
  // People who already saw the previous guide can replay the expanded version.
  try { acknowledged ||= localStorage.getItem(storageKey)==='complete'||localStorage.getItem(accountKey('flowlist-onboarding-v1'))==='seen'; } catch {}
  const clamp=(n,min,max)=>Math.max(min,Math.min(n,Math.max(min,max)));
  const active=()=>!overlay.classList.contains('hidden');
  function rememberProgress(){if(required)try{localStorage.setItem(progressKey,String(index));}catch{}}
  function fitExample() {
    if(stage.hidden)return;
    const margin=12,gap=20,w=card.offsetWidth,h=card.offsetHeight;
    if(innerWidth>=720) {
      const width=Math.min(560,innerWidth-w-gap-margin*2),left=Math.max(margin,(innerWidth-width-w-gap)/2);
      stage.style.cssText=`width:${width}px;left:${left}px;top:${margin}px;max-height:${innerHeight-margin*2}px`;
      card.style.left=`${left+width+gap}px`;card.style.top=`${clamp((innerHeight-h)/2,margin,innerHeight-h-margin)}px`;
    } else {
      stage.style.cssText=`width:${innerWidth-margin*2}px;left:${margin}px;top:${margin}px;max-height:${Math.max(120,innerHeight-h-gap-margin*2)}px`;
      card.style.left=`${margin}px`;card.style.top=`${innerHeight-h-margin}px`;
    }
  }
  function position() {
    if(!active() || !target?.isConnected)return;
    const margin=12,gap=14;
    fitExample();
    live?.position();
    const nav=el(`nav-${steps[index].view}`),nr=nav.getBoundingClientRect();
    tabRing.hidden=nr.bottom<0||nr.top>innerHeight;
    tabRing.style.cssText=`left:${nr.left}px;top:${nr.top}px;width:${nr.width}px;height:${nr.height}px`;
    const r=target.getBoundingClientRect(),w=card.offsetWidth,h=card.offsetHeight;
    if(!r.width || !r.height){spotlight.hidden=true;return;}
    spotlight.hidden=false;
    const radius=getComputedStyle(target).borderRadius;
    spotlight.style.cssText=`left:${r.left-3}px;top:${r.top-3}px;width:${r.width+6}px;height:${r.height+6}px;border-radius:${radius==='0px'?'7px':radius}`;
    if(!stage.hidden)return;
    let left=clamp(r.left,margin,innerWidth-w-margin),top;
    if(r.bottom+gap+h<=innerHeight-margin)top=r.bottom+gap;
    else if(r.top-gap-h>=margin)top=r.top-gap-h;
    else if(r.left-gap-w>=margin){left=r.left-gap-w;top=clamp((innerHeight-h)/2,margin,innerHeight-h-margin);}
    else if(r.right+gap+w<=innerWidth-margin){left=r.right+gap;top=clamp((innerHeight-h)/2,margin,innerHeight-h-margin);}
    else top=clamp(innerHeight-h-margin,margin,innerHeight-h-margin);
    card.style.left=`${left}px`;card.style.top=`${top}px`;
  }
  // Rectangles can move without resizing (page animation, async content, zoom).
  // Track while open; stop immediately when closed or signed out.
  function track(){if(!active()){cancelAnimationFrame(frame);return;}position();frame=requestAnimationFrame(track);}
  function centerTarget() {
    if(!target)return;
    if(!stage.hidden){fitExample();const r=target.getBoundingClientRect(),s=stage.getBoundingClientRect();stage.scrollTop+=r.top-s.top-(stage.clientHeight-r.height)/2;}
    else {
      target.scrollIntoView({block:'center',behavior:'instant'});
      const r=target.getBoundingClientRect(),h=card.offsetHeight,gap=14,margin=12;
      const verticalRoom=r.bottom+gap+h<=innerHeight-margin || r.top-gap-h>=margin;
      const sideRoom=r.left-gap-card.offsetWidth>=margin || r.right+gap+card.offsetWidth<=innerWidth-margin;
      if(!verticalRoom&&!sideRoom)window.scrollBy({top:r.top-margin,behavior:'instant'});
    }
    position();
  }
  async function render() {
    live?.restore();live=null;preview.hidden=true;
    const ticket=++renderId, step=steps[index];target=null;spotlight.hidden=true;
    next.disabled=true;back.disabled=true;
    el('onboarding-count').textContent=`${index+1} / ${steps.length}`;
    el('onboarding-tab').textContent={goals:'Plan',dashboard:'Today',history:'History'}[step.view];
    choice.hidden=index!==steps.length-1||!sample;
    back.textContent='Back';
    title.textContent=step.title;el('onboarding-description').textContent=step.description;
    next.textContent=index===steps.length-1?'Finish guide':'Next';
    rememberProgress();
    if(loadedView!==step.view)await navigate(step.view);
    if(ticket!==renderId || !active() || accountLocked())return;
    loadedView=step.view;
    const requestedExample=step.priority&&!sample?'priority':step.example || '';
    if(example!==requestedExample) {
      stage.replaceChildren();example=requestedExample;stage.scrollTop=0;
      if(example==='review')createReviewExample(stage,()=>{if(index===5)advance();else {index=5;render();}});
      if(example==='priority')createPriorityExample(stage,preview);
    }
    stage.hidden=!example;stage.classList.toggle('session-review',example==='review');overlay.classList.toggle('has-example',Boolean(example));
    if(step.priority){
      const button=sample&&document.querySelector(`#goal-${sample.id} .task-priority`);
      if(!sample){target=stage.querySelector('#guide-demo-priority');preview.hidden=false;el('onboarding-description').textContent='Try this example star. In Plan, starring a task adds it to Priority tasks on Today.';}
      else if(button){live=liftPriority(button,overlay,preview);target=live.anchor;}
      else {target=document.querySelector('.plan-create-actions');el('onboarding-description').textContent='Your example is already complete. Open tasks have a star that adds them to Priority tasks on Today.';}
    }else target=document.querySelector(step.target);
    next.disabled=false;back.disabled=index===0;
    centerTarget();title.focus({preventScroll:true});
    requestAnimationFrame(()=>{if(ticket===renderId && active())centerTarget();});
  }
  function open(mandatory=false) {
    if(accountLocked() || !document.body.classList.contains('app-ready') || active())return;
    if([...document.querySelectorAll('.overlay')].some(node=>node!==overlay&&!node.classList.contains('hidden')))return;
    returnFocus=document.activeElement instanceof HTMLElement && document.activeElement!==document.body?document.activeElement:trigger;
    required=mandatory;index=0;loadedView='';sample=null;preparationFailed=false;choice.querySelector('input[value=keep]').checked=true;choice.hidden=true;error.hidden=true;
    if(required)try{index=clamp(Number(localStorage.getItem(progressKey))||0,0,steps.length-1);}catch{}
    closeButton.hidden=required;closeButton.textContent='Close guide';
    overlay.classList.remove('hidden');document.body.classList.add('guide-open');syncDialogs();
    prepare();cancelAnimationFrame(frame);track();
  }
  async function prepare() {
    const ticket=++prepareId;preparing=true;preparationFailed=false;next.disabled=true;back.disabled=true;back.textContent='Back';error.hidden=true;
    el('onboarding-tab').textContent='Guide';el('onboarding-count').textContent='';
    title.textContent='Preparing your example';el('onboarding-description').textContent='One small project to explore in Plan.';
    try {
      const result=await api('/guide/example',{method:'POST'});
      if(ticket!==prepareId||!active()||accountLocked())return;sample=result;
      prepareExample(sample);await render();
    }catch(failure){if(ticket===prepareId&&active()&&!accountLocked()){
      // Older beta servers lack this optional endpoint. Teach the same features
      // with isolated practice controls instead of blocking the entire app.
      if([404,405].includes(failure.status)) { sample=null;await render(); }
      else {preparationFailed=true;title.textContent='The example couldn’t load';error.hidden=false;error.textContent='Retry, or use Flowlist and open Guide later.';next.textContent='Retry';next.disabled=false;back.textContent='Use Flowlist';back.disabled=false;title.focus();}
    }}
    finally{if(ticket===prepareId)preparing=false;}
  }
  async function finish() {
    if(finishing)return;finishing=true;next.disabled=true;back.disabled=true;closeButton.disabled=true;error.hidden=true;
    try {
      if(sample&&choice.querySelector('input:checked').value==='remove'){
        try{await api(`/guide/example/${sample.id}`,{method:'DELETE'});}catch(failure){if(failure.status!==404)throw failure;}
      }
      close(true);
    }catch(failure){error.hidden=false;error.textContent='Could not remove the example. Retry, or choose Keep example.';}
    finally{finishing=false;next.disabled=false;back.disabled=false;closeButton.disabled=false;}
  }
  function close(completed=false) {
    if(accountLocked() || (required&&!completed&&!preparationFailed))return;
    if(preparationFailed&&!completed)deferred=true;
    live?.restore();live=null;tabRing.hidden=true;
    prepareId++;renderId++;overlay.classList.add('hidden');document.body.classList.remove('guide-open');syncDialogs();
    cancelAnimationFrame(frame);target=null;stage.hidden=true;stage.replaceChildren();example='';
    if(completed && !acknowledged) {
      acknowledged=true;
      try{localStorage.setItem(storageKey,'complete');localStorage.removeItem(progressKey);}catch{}
      if(preferences.save)preferences.save(VERSION).catch(()=>{
        if(!accountLocked())showToast('Guide completed. Your account preference could not sync.',true);
      });
    }
    (returnFocus?.isConnected&&returnFocus.getClientRects().length?returnFocus:trigger).focus();
  }
  function advance(){if(next.disabled||preparing)return;if(!error.hidden&&!sample){prepare();return;}if(index<steps.length-1){index++;render();}else finish();}
  function startIfNew(){const ritual=isNative()?nativeState()?.timer:readRitual();if(preferences.automatic&&!acknowledged&&!deferred&&(!ritual||ritual.phase==='saved'))open(true);}
  trigger.addEventListener('click',()=>open(Boolean(preferences.automatic&&!acknowledged)));
  closeButton.addEventListener('click',()=>close());
  back.addEventListener('click',()=>{if(preparationFailed)close();else if(index>0){index--;render();}});next.addEventListener('click',advance);
  window.addEventListener('resize',()=>{if(active())centerTarget();});
  window.visualViewport?.addEventListener('resize',()=>{if(active())centerTarget();});
  // A restored session takes precedence; its eventual dismissal can start the guide.
  const observer=new MutationObserver(()=>{
    if(!active()){live?.restore();live=null;tabRing.hidden=true;document.body.classList.remove('guide-open');cancelAnimationFrame(frame);}
    if(!accountLocked())startIfNew();
  });
  document.querySelectorAll('.overlay').forEach(node=>observer.observe(node,{attributes:true,attributeFilter:['class']}));
  return {startIfNew,handleKey(event){
    if(!active())return false;
    if(event.key==='Escape'){event.preventDefault();if((!required||preparationFailed)&&!finishing)close();}else trapFocus(event,overlay);
    return true;
  }};
}
