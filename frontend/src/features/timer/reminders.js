import { accountKey, accountLocked } from '../../shared/account';
const PREFERENCE_KEY = 'flowlist-desktop-reminders';
const NOTICE_KEY = () => accountKey('flowlist-interval-notice');

function reminderCopy(previous, next) {
  if (previous.phase === 'focus') {
    const cycle = next.breakKind === 'long';
    return {
      title: cycle ? 'Cycle complete' : `Focus round ${previous.round} complete`,
      body: `${cycle ? 'Long' : 'Short'} break started · ${next.blockSeconds / 60} minutes.`,
    };
  }
  return {
    title: `${previous.breakKind === 'long' ? 'Long' : 'Short'} break complete`,
    body: `Focus round ${next.round} of ${next.settings.rounds} started · ${next.settings.focus} minutes.`,
  };
}

export function initReminders({ showToast }) {
  const button = document.getElementById('desktop-reminders-toggle');
  const status = document.getElementById('desktop-reminders-status');
  const supported = 'Notification' in window && window.isSecureContext;
  let busy = false;
  let enabled = false;
  const readPreference = () => {
    try { enabled = localStorage.getItem(PREFERENCE_KEY) === 'on'; } catch { enabled = false; }
  };
  function render() {
    readPreference();
    const granted = supported && Notification.permission === 'granted';
    const blocked = supported && Notification.permission === 'denied';
    button.disabled = busy || !supported || blocked;
    button.setAttribute('aria-pressed', String(enabled && granted));
    button.textContent = busy ? 'Waiting for permission…' : enabled && granted ? 'Turn off desktop reminders' : 'Enable desktop reminders';
    status.textContent = !supported
      ? 'This browser supports in-app reminders only.'
      : blocked ? 'Notifications are blocked. You can allow them in this site’s browser settings. In-app reminders stay on.'
      : enabled && granted ? 'Desktop reminders are on for this browser. Changes apply immediately.'
      : 'In-app reminders are on. Enable desktop reminders to see a message while you’re elsewhere.';
  }
  button.addEventListener('click', async () => {
    busy = true;
    render();
    try {
      const turnOff = enabled && Notification.permission === 'granted';
      // Ask only on the explicit Enable gesture, never on load or at an interval boundary.
      const permission = turnOff ? 'granted' : await Notification.requestPermission();
      if (permission === 'granted') localStorage.setItem(PREFERENCE_KEY, turnOff ? 'off' : 'on');
    } catch {
      showToast('Desktop reminders could not be enabled. In-app reminders are still on.', true);
    } finally { busy = false; render(); }
  });
  const showInApp = notice => showToast(`${notice.title}. ${notice.body}`, false, null, 8000);
  window.addEventListener('storage', event => {
    if (event.key === PREFERENCE_KEY || event.key === null) render();
    // The tab which advances the shared timer owns the desktop notification.
    // Other tabs show only the same gentle in-app message, without moving focus.
    if (!accountLocked() && event.key === NOTICE_KEY() && event.newValue) {
      try {
        const notice = JSON.parse(event.newValue);
        if (typeof notice.title === 'string' && typeof notice.body === 'string' && Math.abs(Date.now() - notice.at) < 15000) showInApp(notice);
      } catch { /* Ignore malformed cross-tab messages. */ }
    }
  });
  window.addEventListener('focus', render);
  render();
  return {
    render,
    notify(previous, next) {
      const notice = {...reminderCopy(previous, next), at: Date.now(), id: `${previous.id}:${previous.deadline}`};
      showInApp(notice);
      try { localStorage.setItem(NOTICE_KEY(), JSON.stringify(notice)); } catch { /* Timer remains usable if notice storage is unavailable. */ }
      readPreference();
      if (!supported || !enabled || Notification.permission !== 'granted' || (document.visibilityState === 'visible' && document.hasFocus())) return;
      try {
        new Notification(notice.title, {body: notice.body, icon:'/favicon.svg?v=20260920-2', tag:'flowlist-interval', silent:true, requireInteraction:false});
      } catch { /* Some browsers expose Notification but cannot construct one; in-app notice remains. */ }
    },
  };
}
