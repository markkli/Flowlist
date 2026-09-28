// Lift the actual Plan button above the modal scrim; its existing handler and
// API writes stay intact. The anchor preserves its layout in the real task row.
export function liftPriority(button,overlay,preview) {
  const anchor=document.createElement('span'),rect=button.getBoundingClientRect(),style=button.getAttribute('style');
  anchor.className='guide-priority-anchor';anchor.style.cssText=`display:block;width:${rect.width}px;height:${rect.height}px;flex-shrink:0;grid-area:${getComputedStyle(button).gridArea}`;
  button.before(anchor);overlay.append(button);button.classList.add('guide-live-priority');
  const title=button.getAttribute('aria-label').replace(/^(Prioritize|Unstar) /,'');
  preview.hidden=false;
  preview.innerHTML='<small>Today → Priority tasks</small><p role="status"></p>';
  const sync=()=>{preview.querySelector('p').textContent=button.disabled?'Saving…':button.getAttribute('aria-pressed')==='true'?`★ ${title}`:'Star this task to place it here.';};
  const observer=new MutationObserver(sync);observer.observe(button,{attributes:true,attributeFilter:['aria-pressed','disabled']});sync();
  return {anchor,button,position(){const r=anchor.getBoundingClientRect();button.style.cssText=`position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0`;},restore(){observer.disconnect();button.classList.remove('guide-live-priority');if(style===null)button.removeAttribute('style');else button.setAttribute('style',style);anchor.replaceWith(button);preview.hidden=true;}};
}
