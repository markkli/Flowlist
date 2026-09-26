import { accountKey, accountLocked } from '../../shared/account';
import { syncDialogs, trapFocus } from '../../shared/dom';
import { readRitual } from '../timer/state';
import './onboarding.css';

const VERSION = 1;
const steps = [
  {
    name: 'Plan', title: 'Give your work a home.',
    description: 'Start in Plan. Create a Project for something you want to build or learn, then break it into tasks and smaller steps. Use Task for a simple, one-off item.',
    tips: [
      ['Project → Add step', 'Keep a short list of projects or learning goals you actually want to work on.'],
      ['Task menu ···', 'Add one layer of smaller steps, rename a task, or add it to your focus queue.'],
    ],
    note: 'The arrow expands a task. The checkbox finishes it. Finishing a parent also finishes its smaller steps; finishing every smaller step leaves the parent for you to review.',
    preview: '<div class="guide-example-label">Example plan</div><div class="guide-project"><span class="guide-preview-meta">PROJECT</span><strong>Learn something new</strong><div class="guide-example-task"><i></i>Understand the basics</div><div class="guide-example-subtask"><i></i>Read the first chapter</div><div class="guide-example-subtask"><i></i>Try one small exercise</div></div><div class="guide-single-task"><i></i>Send that email<span>One-off task</span></div>',
  },
  {
    name: 'Focus', title: 'Press play. Stay with the work.',
    description: 'Go to Today and press the Pomodoro dial to start. You do not need to select a task first. Focus and breaks follow your cycle; name the work when you finish.',
    tips: [
      ['Task queue', 'An optional shortlist for today. Add tasks from Plan or choose them here, then put them in the order you want.'],
      ['Cycle settings', 'The button above the dial changes focus time, breaks, rounds, and desktop reminders.'],
      ['Minimize timer / End ritual', 'Minimize keeps the clock running while you browse. End ritual takes you to the review when you are ready to stop.'],
    ],
    note: 'Keep this tab open for interval reminders. Sleeping computers and suspended browsers can delay them.',
    preview: '<div class="guide-example-label">Today · Pomodoro</div><div class="guide-demo-dial"><strong>25:00</strong><span>Start focus <svg viewBox="0 0 24 24"><path d="m9 6 9 6-9 6Z"/></svg></span></div><div class="guide-cycle"><span>Focus</span><b>→</b><span>Break</span><b>→</b><span>Repeat</span></div><p class="guide-preview-caption">One interval at a time.</p>',
  },
  {
    name: 'Review', title: 'Record progress, not just finished tasks.',
    description: 'When the full cycle ends, or you choose End ritual, select what you worked on. Check Finished only for work you completed, then press Save ritual.',
    tips: [
      ['Worked on / Finished', 'You can log time against a task without crossing it off. Tasks and smaller steps can both be selected.'],
      ['A note, if it helps', 'Write a short reflection or add a missing task. Leave tasks unselected to record General focus.'],
    ],
    note: 'Save ritual adds the session to History and updates finished tasks in Plan. Save later keeps an unfinished review on this browser, ready to reopen.',
    preview: '<div class="guide-example-label">Example review</div><div class="guide-review-example"><div class="guide-review-head"><span>Task</span><span>Worked on</span><span>Finished</span></div><div class="guide-review-row"><strong>Read the chapter</strong><i class="checked">✓</i><i class="checked">✓</i></div><div class="guide-review-row"><strong>Try an exercise</strong><i class="checked">✓</i><i></i></div><p>Made a start on the exercise. Pick up here tomorrow.</p></div><p class="guide-preview-caption">Partial progress counts, too.</p>',
  },
  {
    name: 'History', title: 'See where your attention went.',
    description: 'History brings together your saved focus blocks, notes, and completed work. Use the week view to see your time or open a session to review what you accomplished.',
    tips: [
      ['History', 'Move between weeks, open a saved session, or export your data. This calendar records work you have done.'],
      ['Make it yours', 'Use Appearance in the top bar for landscapes and colors. The sun or moon button switches light and dark mode.'],
      ['Help is always here', 'Reopen this guide from Help in the top bar whenever you need it.'],
    ],
    note: 'A simple rhythm: keep your intentions in Plan, start focusing from Today, and save what happened afterward.',
    preview: '<div class="guide-example-label">Your rhythm</div><div class="guide-rhythm"><span>01</span><div><strong>Plan a little</strong><small>Keep the next step within reach.</small></div><span>02</span><div><strong>Focus on one thing</strong><small>Give it your attention.</small></div><span>03</span><div><strong>Look back</strong><small>Leave a note for tomorrow.</small></div></div>',
  },
];

export function initOnboarding({ preferences = {}, showToast, navigate }) {
  const overlay = document.getElementById('onboarding-overlay');
  const trigger = document.getElementById('help-toggle');
  const title = document.getElementById('onboarding-title');
  const next = document.getElementById('onboarding-next');
  const back = document.getElementById('onboarding-back');
  const finishActions = document.getElementById('onboarding-finish');
  const storageKey = accountKey('flowlist-onboarding-v1');
  let index = 0;
  let returnFocus = trigger;
  let acknowledged = Number(preferences.version) >= VERSION;
  try { acknowledged ||= localStorage.getItem(storageKey) === 'seen'; } catch { /* Server preference remains usable. */ }

  function render() {
    const step = steps[index];
    document.getElementById('onboarding-count').textContent = `Step ${index + 1} of ${steps.length}`;
    title.textContent = step.title;
    document.getElementById('onboarding-description').textContent = step.description;
    const tips = document.getElementById('onboarding-tips');
    tips.replaceChildren(...step.tips.map(([label, copy]) => {
      const item = document.createElement('div');
      const name = document.createElement('dt'); name.textContent = label;
      const description = document.createElement('dd'); description.textContent = copy;
      item.append(name, description); return item;
    }));
    document.getElementById('onboarding-note').textContent = step.note;
    // Only static, developer-authored examples; no account data enters this markup.
    document.getElementById('onboarding-preview').innerHTML = step.preview;
    document.querySelectorAll('[data-guide-step]').forEach((button, i) => {
      if (i === index) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    back.disabled = index === 0;
    next.hidden = index === steps.length - 1;
    next.textContent = index < steps.length - 1 ? `Next: ${steps[index + 1].name}` : 'Next';
    finishActions.hidden = index !== steps.length - 1;
    document.getElementById('onboarding-body').scrollTop = 0;
    title.focus({ preventScroll: true });
  }

  function open() {
    if (accountLocked() || !document.body.classList.contains('app-ready')) return;
    if ([...document.querySelectorAll('.overlay')].some(node => node !== overlay && !node.classList.contains('hidden'))) return;
    returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : trigger;
    index = 0;
    document.getElementById('onboarding-skip').textContent = acknowledged ? 'Close guide' : 'Skip guide';
    overlay.classList.remove('hidden'); syncDialogs(); render();
  }

  function close(destination) {
    if (accountLocked()) return;
    overlay.classList.add('hidden'); syncDialogs();
    if (!acknowledged) {
      acknowledged = true;
      try { localStorage.setItem(storageKey, 'seen'); } catch { /* A disabled storage area must not trap the user. */ }
      if (preferences.save) preferences.save(VERSION).catch(() => {
        if (!accountLocked()) showToast('The guide is dismissed here, but could not sync to your account. You can reopen it from Help.', true);
      });
    }
    if (destination) {
      navigate(destination);
      document.getElementById(`nav-${destination}`).focus();
    } else (returnFocus?.isConnected ? returnFocus : trigger).focus();
  }

  trigger.addEventListener('click', open);
  document.getElementById('onboarding-skip').addEventListener('click', () => close());
  back.addEventListener('click', () => { if (index > 0) { index--; render(); } });
  next.addEventListener('click', () => { if (index < steps.length - 1) { index++; render(); } });
  document.querySelectorAll('[data-guide-step]').forEach(button => button.addEventListener('click', () => { index = Number(button.dataset.guideStep); render(); }));
  document.getElementById('onboarding-plan').addEventListener('click', () => close('goals'));
  document.getElementById('onboarding-today').addEventListener('click', () => close('dashboard'));
  return {
    startIfNew() {
      // Never cover an active timer or an unfinished review when restoring a tab.
      const ritual = readRitual();
      if (preferences.automatic && !acknowledged && (!ritual || ritual.phase === 'saved')) open();
    },
    handleKey(event) {
      if (overlay.classList.contains('hidden')) return false;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else trapFocus(event, overlay);
      return true;
    },
  };
}
