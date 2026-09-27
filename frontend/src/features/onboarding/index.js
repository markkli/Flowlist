import { accountKey, accountLocked } from '../../shared/account';
import { syncDialogs, trapFocus } from '../../shared/dom';
import { readRitual } from '../timer/state';
import './onboarding.css';

const VERSION = 1;
const steps = [
  {view:'goals',target:'[data-goal-create=project]',title:'Plan your work',description:'Add a Project with steps, or a standalone Task. Star tasks to prioritize them on Today.'},
  {view:'dashboard',target:'#start-pomodoro',title:'Start focusing',description:'Press the dial to begin. When you end a session, add a note and mark what you worked on or finished.'},
  {view:'history',target:'#history-next',title:'Review your time',description:'Scroll across weeks to see saved sessions. Select a block to read its notes and tasks.'},
];

export function initOnboarding({ preferences = {}, showToast, navigate }) {
  const overlay=document.getElementById('onboarding-overlay');
  const trigger=document.getElementById('help-toggle');
  const card=overlay.querySelector('.guide-modal');
  const spotlight=document.getElementById('guide-spotlight');
  const title=document.getElementById('onboarding-title');
  const next=document.getElementById('onboarding-next');
  const back=document.getElementById('onboarding-back');
  const storageKey=accountKey('flowlist-onboarding-v1');
  let index=0, target=null, returnFocus=trigger, frame;
  let acknowledged=Number(preferences.version)>=VERSION;
  try { acknowledged ||= localStorage.getItem(storageKey)==='seen'; } catch {}

  function position() {
    if (overlay.classList.contains('hidden') || !target) return;
    const r=target.getBoundingClientRect(), gap=14, margin=12;
    const w=card.offsetWidth, h=card.offsetHeight;
    spotlight.style.cssText=`left:${r.left-5}px;top:${r.top-5}px;width:${r.width+10}px;height:${r.height+10}px`;
    let left=Math.max(margin,Math.min(r.left,innerWidth-w-margin));
    let top;
    if(r.bottom+gap+h<=innerHeight-margin) top=r.bottom+gap;
    else if(r.top-gap-h>=margin) top=r.top-gap-h;
    else if(r.left-gap-w>=margin) { left=r.left-gap-w;top=Math.max(margin,(innerHeight-h)/2); }
    else if(r.right+gap+w<=innerWidth-margin) { left=r.right+gap;top=Math.max(margin,(innerHeight-h)/2); }
    else top=Math.max(margin,innerHeight-h-margin);
    card.style.left=`${left}px`;card.style.top=`${top}px`;
  }
  function schedulePosition() { cancelAnimationFrame(frame);frame=requestAnimationFrame(position); }
  const observer=new ResizeObserver(schedulePosition);
  observer.observe(card);
  window.addEventListener('resize',schedulePosition);
  window.addEventListener('scroll',schedulePosition,true);

  function render() {
    const step=steps[index];
    navigate(step.view);
    document.getElementById('onboarding-count').textContent=`${index+1} / ${steps.length}`;
    title.textContent=step.title;
    document.getElementById('onboarding-description').textContent=step.description;
    back.disabled=index===0;
    next.textContent=index===steps.length-1 ? 'Done' : 'Next';
    if(target) observer.unobserve(target);
    target=document.querySelector(step.target);
    if(target) {
      observer.observe(target);
      target.scrollIntoView({block:'center',behavior:'instant'});
    }
    position();schedulePosition();
    title.focus({preventScroll:true});
  }
  function open() {
    if(accountLocked() || !document.body.classList.contains('app-ready'))return;
    if([...document.querySelectorAll('.overlay')].some(node=>node!==overlay&&!node.classList.contains('hidden')))return;
    returnFocus=document.activeElement instanceof HTMLElement && document.activeElement!==document.body ? document.activeElement : trigger;
    index=0;
    document.getElementById('onboarding-skip').textContent=acknowledged?'Close guide':'Skip guide';
    overlay.classList.remove('hidden');syncDialogs();render();
  }
  function close() {
    if(accountLocked())return;
    overlay.classList.add('hidden');syncDialogs();
    if(target)observer.unobserve(target);target=null;
    if(!acknowledged) {
      acknowledged=true;
      try{localStorage.setItem(storageKey,'seen');}catch{}
      if(preferences.save)preferences.save(VERSION).catch(()=>{
        if(!accountLocked())showToast('Guide dismissed. Your account preference could not sync.',true);
      });
    }
    (returnFocus?.isConnected && returnFocus.getClientRects().length ? returnFocus : trigger).focus();
  }
  trigger.addEventListener('click',open);
  document.getElementById('onboarding-skip').addEventListener('click',close);
  back.addEventListener('click',()=>{if(index>0){index--;render();}});
  next.addEventListener('click',()=>{if(index<steps.length-1){index++;render();}else close();});
  return {
    startIfNew(){const ritual=readRitual();if(preferences.automatic&&!acknowledged&&(!ritual||ritual.phase==='saved'))open();},
    handleKey(event){
      if(overlay.classList.contains('hidden'))return false;
      if(event.key==='Escape'){event.preventDefault();close();}else trapFocus(event,overlay);
      return true;
    },
  };
}
