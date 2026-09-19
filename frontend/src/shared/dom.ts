/** Safe in text and quoted HTML attributes; prefer DOM properties for dynamic attributes. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
export function trapFocus(event: KeyboardEvent, container: HTMLElement): void {
  if (event.key !== 'Tab') return;
  const items = [...container.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')].filter(el => !el.hidden && el.offsetParent !== null);
  if (!items.length) { event.preventDefault(); container.focus(); return; }
  const first = items[0], last = items[items.length - 1];
  if (!container.contains(document.activeElement) || document.activeElement === container || (event.shiftKey && document.activeElement === first)) {
    event.preventDefault(); (event.shiftKey ? last : first).focus();
  } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

export function syncDialogs(): void {
  const open = [...document.querySelectorAll('.overlay')].some(el => !el.classList.contains('hidden'));
  document.body.classList.toggle('modal-open', open);
  const shell = document.querySelector<HTMLElement>('.app-shell');
  const mini = document.getElementById('timer-mini');
  if (shell) shell.inert = open;
  if (mini) mini.inert = open;
}
export function observeDialogs(): void {
  const observer = new MutationObserver(syncDialogs);
  document.querySelectorAll('.overlay').forEach(el => observer.observe(el, {attributes:true, attributeFilter:['class']}));
  syncDialogs();
}
