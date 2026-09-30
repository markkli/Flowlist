import { isNative, nativeCall, nativeState } from '../../shared/native';
import { syncDialogs, trapFocus } from '../../shared/dom';
import './mac-setup.css';

/** Device setup follows the account's Guide and never competes with a session. */
export function initMacSetup() {
  if (!isNative() || !nativeState()?.macSetup) return { handleKey: () => false };
  let completed = nativeState()!.macSetup!.version >= 1;
  let guideCompleted = Boolean(nativeState()?.onboarding?.version);
  let busy = false;
  const overlay = document.createElement('div');
  overlay.className = 'overlay hidden mac-setup-overlay';
  overlay.innerHTML = `<section class="mac-setup-card" role="dialog" aria-modal="true" aria-labelledby="mac-setup-title">
    <p class="eyebrow">ON YOUR MAC</p><h2 id="mac-setup-title" tabindex="-1">Keep focus within reach</h2>
    <label class="mac-setup-option"><input type="checkbox" id="mac-menu-enabled"><span><strong>Menu-bar clock</strong><small>Start, pause, and check your timer without opening the workspace.</small></span></label>
    <div class="mac-widget-info"><strong>Desktop widget</strong><p id="mac-widget-copy"></p></div>
    <p class="mac-setup-error" role="alert"></p>
    <button type="button" class="primary-btn">Start using Flowlist</button>
  </section>`;
  document.body.append(overlay);
  const menu = overlay.querySelector<HTMLInputElement>('input')!;
  const submit = overlay.querySelector<HTMLButtonElement>('button')!;
  const error = overlay.querySelector<HTMLElement>('[role=alert]')!;
  menu.checked = nativeState()!.macSetup!.menuEnabled;
  overlay.querySelector('#mac-widget-copy')!.textContent = nativeState()!.macSetup!.widgetIncluded
    ? 'Right-click your desktop, choose Edit Widgets, then search for Flowlist. Click the widget to open your timer.'
    : 'The desktop widget is not included in this beta download. The menu-bar clock is available now.';
  function startIfReady() {
    if (completed || !guideCompleted || !document.body.classList.contains('app-ready') || nativeState()?.timer) return;
    if ([...document.querySelectorAll('.overlay')].some(el => !el.classList.contains('hidden'))) return;
    overlay.classList.remove('hidden');syncDialogs();
    overlay.querySelector<HTMLElement>('h2')!.focus();
  }
  const observer = new MutationObserver(startIfReady);
  document.querySelectorAll('.overlay').forEach(el => observer.observe(el, {attributes:true,attributeFilter:['class']}));
  window.addEventListener('flowlist:guide-complete', () => {guideCompleted = true; startIfReady();});
  submit.onclick = async () => {
    if (busy) return;
    busy = true;submit.disabled = true;error.textContent = '';
    try {
      await nativeCall('macSetup', {menuEnabled:menu.checked});
      completed = true;observer.disconnect();overlay.classList.add('hidden');syncDialogs();
      document.getElementById('nav-dashboard')?.click();
      document.getElementById('start-pomodoro')?.focus();
    } catch (failure) { error.textContent = (failure as Error).message; }
    finally {busy = false;submit.disabled = false;}
  };
  startIfReady();
  return {handleKey(event:KeyboardEvent) {
    if (overlay.classList.contains('hidden')) return false;
    if (event.key === 'Escape') event.preventDefault();
    trapFocus(event, overlay);return true;
  }};
}
