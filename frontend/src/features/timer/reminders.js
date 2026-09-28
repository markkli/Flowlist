import { isNative, nativeCall, nativeState, onNativeState } from '../../shared/native';
import { accountKey, accountLocked } from '../../shared/account';
import './reminders.css';
const SOUND_KEY = 'flowlist-reminder-sound';
const PREFERENCE_KEY = 'flowlist-desktop-reminders';
const INVITATION_KEY = 'flowlist-reminder-invitation-seen';
const NOTICE_KEY = () => accountKey('flowlist-interval-notice');

function reminderCopy(previous, next) {
  if (previous.phase === 'focus') {
    const cycle = next.breakKind === 'long';
    return {
      title: cycle ? 'Cycle complete' : `Focus round ${previous.round} complete`,
      body: `${cycle ? 'Long' : 'Short'} break started · ${next.blockSeconds / 60} minutes. Take a break.`,
    };
  }
  return {
    title: `${previous.breakKind === 'long' ? 'Long' : 'Short'} break complete`,
    body: `Focus round ${next.round} of ${next.settings.rounds} started · ${next.settings.focus} minutes. Time to focus.`,
  };
}

export function initReminders({ showToast }) {
  if(isNative()) return initNativeReminders({showToast});
  const button = document.getElementById('desktop-reminders-toggle');
  const status = document.getElementById('desktop-reminders-status');
  const soundButton = document.getElementById('reminder-sound-toggle');
  const noticeBox = document.getElementById('interval-reminder');
  const invitation = document.getElementById('reminder-invitation');
  const inviteEnable = document.getElementById('reminder-invitation-enable');
  let invitationSeen = false;
  let noticeTimer;
  let audio;
  let soundEnabled = true;
  function readSound() {
    try { soundEnabled = localStorage.getItem(SOUND_KEY) !== 'off'; } catch { soundEnabled = true; }
    soundButton.checked = soundEnabled;
  }
  function prepareAudio() {
    readSound();
    if (!soundEnabled || accountLocked()) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try { audio ||= new Audio(); if (audio.state === 'suspended') audio.resume().catch(() => {}); } catch { /* Popup still works without audio. */ }
  }
  function chime() {
    readSound();
    if (!soundEnabled || !audio || audio.state !== 'running') return;
    try {
      const start = audio.currentTime;
      [660,880].forEach((frequency,index) => {
        const oscillator = audio.createOscillator(); const gain = audio.createGain();
        const at = start + index * .22;
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0,at); gain.gain.linearRampToValueAtTime(.09,at+.025);
        gain.gain.exponentialRampToValueAtTime(.001,at+.5);
        oscillator.connect(gain); gain.connect(audio.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(at); oscillator.stop(at+.55);
      });
    } catch { /* Audio is best-effort; never stop the clock. */ }
  }
  soundButton.addEventListener('change', () => {
    try { localStorage.setItem(SOUND_KEY,soundButton.checked ? 'on' : 'off'); } catch {}
    soundEnabled = soundButton.checked;
    if (soundEnabled) { prepareAudio(); chime(); }
  });
  // Browsers unlock audio only after a gesture; never ask for notification permission here.
  document.addEventListener('pointerdown',prepareAudio,{once:true});
  document.addEventListener('keydown',prepareAudio,{once:true});
  document.getElementById('interval-reminder-dismiss').onclick = () => { noticeBox.hidden = true; clearTimeout(noticeTimer); };
  document.getElementById('interval-reminder-open').onclick = () => {
    noticeBox.hidden = true;
    document.getElementById('timer-mini-open').click();
  };
  const supported = 'Notification' in window && window.isSecureContext;
  let busy = false;
  let enabled = false;
  const readPreference = () => {
    try { enabled = localStorage.getItem(PREFERENCE_KEY) === 'on'; } catch { enabled = false; }
  };
  function render() {
    readPreference(); readSound();
    const granted = supported && Notification.permission === 'granted';
    const blocked = supported && Notification.permission === 'denied';
    button.disabled = busy || !supported || blocked;
    inviteEnable.disabled = busy;
    inviteEnable.textContent = busy ? 'Waiting for permission…' : 'Enable notifications';
    if (granted || blocked) invitation.hidden = true;
    button.setAttribute('aria-pressed', String(enabled && granted));
    button.textContent = busy ? 'Waiting for permission…' : enabled && granted ? 'Turn off desktop reminders' : 'Enable desktop reminders';
    status.textContent = !supported
      ? 'This browser supports in-app reminders only.'
      : blocked ? 'Notifications are blocked. You can allow them in this site’s browser settings. In-app reminders stay on.'
      : enabled && granted ? 'Desktop reminders are on for this browser. Changes apply immediately.'
      : 'In-app reminders are on. Enable desktop reminders to see a message while you’re elsewhere.';
  }
  function rememberInvitation() {
    invitationSeen = true;
    try { localStorage.setItem(INVITATION_KEY,'yes'); } catch {}
  }
  function offerNotifications() {
    invitation.hidden = true;
    readPreference(); readSound();
    if (!supported || accountLocked()) return;
    let preference = null;
    try {
      preference = localStorage.getItem(PREFERENCE_KEY);
      invitationSeen ||= localStorage.getItem(INVITATION_KEY) === 'yes';
    } catch {}
    // Existing browser permission is sufficient. Respect an explicit app opt-out.
    if (Notification.permission === 'granted') {
      if (preference === null) {
        enabled = true;
        try { localStorage.setItem(PREFERENCE_KEY,'on'); } catch {}
      }
      render();
      return;
    }
    if (Notification.permission !== 'default' || invitationSeen || preference !== null) return;
    document.getElementById('reminder-invitation-copy').textContent = `${soundEnabled ? 'Your gentle chime is on.' : 'Your chime is muted.'} Enable desktop notifications for focus and break reminders while you’re in another app. Keep Flowlist open in a tab.`;
    invitation.hidden = false;
    rememberInvitation();
  }
  async function changeNotifications(forceEnable = false) {
    if (busy) return;
    busy = true;
    render();
    try {
      const turnOff = !forceEnable && enabled && Notification.permission === 'granted';
      // The browser prompt comes only from an explicit Enable click.
      const permission = turnOff || Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission === 'granted') localStorage.setItem(PREFERENCE_KEY, turnOff ? 'off' : 'on');
      if (forceEnable) {
        invitation.hidden = true;
        document.querySelector('#focus-overlay .timer-modal').focus();
        showToast(permission === 'granted' ? 'Desktop reminders enabled.' : 'In-app reminders stay on. You can enable desktop reminders in Timer settings later.');
      }
    } catch {
      showToast('Desktop reminders could not be enabled. In-app reminders are still on.', true);
    } finally { busy = false; render(); }
  }
  button.addEventListener('click', () => changeNotifications());
  inviteEnable.addEventListener('click', () => { rememberInvitation(); changeNotifications(true); });
  document.getElementById('reminder-invitation-later').addEventListener('click', () => {
    rememberInvitation(); invitation.hidden = true;
    document.querySelector('#focus-overlay .timer-modal').focus();
  });
  const showInApp = notice => {
    document.getElementById('interval-reminder-title').textContent = notice.title + '. ';
    document.getElementById('interval-reminder-copy').textContent = notice.body;
    noticeBox.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { noticeBox.hidden = true; }, 20000);
  };
  window.addEventListener('storage', event => {
    if (event.key === PREFERENCE_KEY || event.key === SOUND_KEY || event.key === INVITATION_KEY || event.key === null) render();
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
  new MutationObserver(() => { if (accountLocked()) { noticeBox.hidden = true; invitation.hidden = true; } }).observe(document.body,{attributes:true,attributeFilter:['class']});
  render();
  return {
    render, prepareAudio, offerNotifications,
    notify(previous, next) {
      const notice = {...reminderCopy(previous, next), at: Date.now(), id: `${previous.id}:${previous.deadline}`};
      showInApp(notice);
      chime();
      try { localStorage.setItem(NOTICE_KEY(), JSON.stringify(notice)); } catch { /* Timer remains usable if notice storage is unavailable. */ }
      readPreference();
      if (!supported || !enabled || Notification.permission !== 'granted' || (document.visibilityState === 'visible' && document.hasFocus())) return;
      try {
        new Notification(notice.title, {body: notice.body, icon:'/favicon.svg?v=20260920-2', tag:'flowlist-interval', silent:true, requireInteraction:false});
      } catch { /* Some browsers expose Notification but cannot construct one; in-app notice remains. */ }
    },
  };
}

function initNativeReminders({showToast}) {
  const button=document.getElementById('desktop-reminders-toggle');
  const status=document.getElementById('desktop-reminders-status');
  const sound=document.getElementById('reminder-sound-toggle');
  const invitation=document.getElementById('reminder-invitation');
  const enable=document.getElementById('reminder-invitation-enable');
  let busy=false,seen=Boolean(nativeState()?.reminderPromptSeen);
  const render=()=>{
    const state=nativeState();
    const granted=state?.notifications==='granted',denied=state?.notifications==='denied';
    sound.checked=state?.sound!==false;
    button.disabled=busy || granted;
    button.textContent=granted?'Notifications enabled':denied?'Open notification settings':'Enable notifications';
    button.setAttribute('aria-pressed',String(granted));
    status.textContent=granted?'Messages appear when focus or a break ends.':denied?'Allow Flowlist in macOS notification settings.':'Enable notifications for reminders while you’re in another app.';
    enable.disabled=busy;
    enable.textContent=busy?'Waiting for permission…':'Enable notifications';
    if(granted||denied)invitation.hidden=true;
  };
  const remember=()=>{
    seen=true;
    nativeCall('reminders',{action:'dismiss'}).catch(error=>showToast(error.message,true));
  };
  const request=async()=>{
    if(busy)return;busy=true;render();
    try {await nativeCall('reminders',{action:nativeState()?.notifications==='denied'?'settings':'enable'});invitation.hidden=true;}
    catch(error) {showToast(error.message,true);}
    finally {busy=false;render();}
  };
  button.onclick=request;enable.onclick=request;
  document.getElementById('reminder-invitation-later').onclick=()=>{remember();invitation.hidden=true;};
  sound.onchange=async()=>{
    sound.disabled=true;
    try {await nativeCall('reminders',{action:'sound',sound:sound.checked});}
    catch(error){showToast(error.message,true);}
    finally {sound.disabled=false;render();}
  };
  // The native process owns reminders even with the main window closed.
  document.querySelector('.timer-reminders > p').textContent='Chimes play when focus and breaks end.';
  document.querySelector('.reminders-note').textContent='Flowlist keeps time from the menu bar when this window is closed.';
  onNativeState(render);render();
  return {render,prepareAudio(){},notify(){},offerNotifications(){
    const state=nativeState();
    if(seen||state?.reminderPromptSeen||state?.notifications!=='default')return;
    invitation.hidden=false;
    document.getElementById('reminder-invitation-copy').textContent='Get a gentle reminder when focus or a break ends, even while you’re in another app.';
    remember();
  }};
}
