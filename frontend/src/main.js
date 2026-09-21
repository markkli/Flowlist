import '../styles.css';
import { observeDialogs } from './shared/dom';
observeDialogs();
import { initPlan } from './features/plan';
import { initDashboard } from './features/dashboard';
import { initHistory } from './features/history';
import { initTimer } from './features/timer';
import { initAppearance } from './features/appearance';
let toastTimer;
function greetingForNow() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
}

function showToast(message, isError = false, action = null) {
  const toast = document.getElementById("app-toast");
  toast.replaceChildren();
  const copy = document.createElement("span");
  copy.textContent = message;
  toast.appendChild(copy);
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label || "Undo";
    button.addEventListener("click", async () => {
      clearTimeout(toastTimer);
      toast.classList.remove("visible");
      await action.run();
    });
    toast.appendChild(button);
  }
  toast.classList.toggle("error", isError);
  toast.classList.toggle("has-action", Boolean(action));
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), action ? 5200 : 2800);
}

function setDateCopy() {
  const today = new Date();
  document.getElementById("dashboard-greeting").textContent = greetingForNow();
  document.getElementById("top-date").innerHTML = `<strong>${today.toLocaleDateString("en", { weekday: "long" })}</strong> · ${today.toLocaleDateString("en", { month: "long", day: "numeric" })}`;
  document.getElementById("today-date-stamp").textContent = today.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("flowlist-theme", theme);
  document.getElementById("theme-icon").innerHTML = theme === "dark"
    ? '<path d="M20.2 15.5A8.5 8.5 0 0 1 8.5 3.8 8.5 8.5 0 1 0 20.2 15.5Z"/>'
    : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>';
}

applyTheme(
  localStorage.getItem("flowlist-theme")
  || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
);
document.getElementById("theme-toggle").addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});


const appearance = initAppearance({ showToast });
const plan = initPlan({ showToast });
const dashboard = initDashboard({ setDateCopy, showToast });
const historyView = initHistory({ showToast, refresh: () => dashboard.loadDashboard() });
const timer = initTimer({ showToast, loadGoals: () => plan.loadGoals(), loadDashboard: () => dashboard.loadDashboard() });
const loaders = { dashboard: dashboard.loadDashboard, goals: plan.loadGoals, history: historyView.loadHistory };
let navigationId = 0;
async function switchView(name) {
  if (!(name in loaders)) name = 'dashboard';
  const request = ++navigationId;
  Object.keys(loaders).forEach(view => {
    document.getElementById(`view-${view}`).classList.toggle('hidden', view !== name);
    const button = document.getElementById(`nav-${view}`);
    button.classList.toggle('active', view === name);
    if (view === name) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  document.getElementById('connection-error').classList.add('hidden');
  const section = document.getElementById(`view-${name}`);
  section.setAttribute("aria-busy", "true");
  try { await loaders[name](); } catch(error) {
    if (request !== navigationId) return;
    document.getElementById('connection-error').classList.remove('hidden');
    document.getElementById('connection-error-copy').textContent = error.message;
  } finally { section.removeAttribute("aria-busy"); }
}
function navigate(name) { location.hash = name; }
Object.keys(loaders).forEach(name => document.getElementById(`nav-${name}`).addEventListener('click', () => navigate(name)));
['open-roadmap','open-roadmap-2'].forEach(id => document.getElementById(id).addEventListener('click', () => navigate('goals')));
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); navigate('dashboard'); });
document.getElementById('retry-view').addEventListener('click', () => switchView(location.hash.slice(1)));
window.addEventListener('hashchange', () => {
  if (location.hash === '#main-content') { document.getElementById('main-content').focus(); return; }
  switchView(location.hash.slice(1)); window.scrollTo(0,0);
});
window.addEventListener('unhandledrejection', event => {
  event.preventDefault();
  showToast(event.reason?.message || 'Could not finish that action. Please try again.', true);
});
document.addEventListener('keydown', event => { if (!appearance.handleKey(event) && !historyView.handleKey(event) && !timer.handleKey(event)) plan.handleKey(event); });
setDateCopy();
switchView(location.hash.slice(1));
if (['goals','history'].includes(location.hash.slice(1))) dashboard.loadDashboard().catch(error => showToast(error.message,true));
