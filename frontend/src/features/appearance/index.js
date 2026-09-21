import { syncDialogs, trapFocus } from '../../shared/dom';
import './appearance.css';
import './palettes.css';

const KEY = 'flowlist-appearance-v1';
const PRESETS = [
  {id:'grove', name:'Grove', note:'Woodland light', image:'grove', light:'#cbd1bd', dark:'#263027'},
  {id:'coast', name:'Coast', note:'Sea & silver sky', image:'coast', light:'#ccd5d6', dark:'#242e33'},
  {id:'hills', name:'Hills', note:'Warm morning light', image:'hills', light:'#dfd4be', dark:'#302c24'},
  {id:'linen', name:'Linen', light:'#ded5c6', dark:'#29251f'},
  {id:'sage', name:'Sage', light:'#cad2c0', dark:'#273027'},
  {id:'slate', name:'Slate', light:'#c8d1d4', dark:'#242d32'},
  {id:'clay', name:'Clay', light:'#dccdc7', dark:'#332a29'},
];
const defaults = {preset:'grove', focusArtwork:true, planArtwork:true};
function readPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    return {preset:PRESETS.some(p=>p.id===value?.preset) ? value.preset : defaults.preset,
      focusArtwork:typeof value?.focusArtwork==='boolean' ? value.focusArtwork : true,
      planArtwork:typeof value?.planArtwork==='boolean' ? value.planArtwork : true};
  } catch { return {...defaults}; }
}
export function initAppearance({showToast}) {
  let preferences = readPreferences();
  const overlay = document.getElementById('appearance-overlay');
  const trigger = document.getElementById('appearance-toggle');
  const focusToggle = document.getElementById('focus-artwork');
  const planToggle = document.getElementById('plan-artwork');
  const render = () => {
    const preset = PRESETS.find(p=>p.id===preferences.preset);
    document.documentElement.dataset.appearance = preset.id;
    document.documentElement.style.setProperty('--scene-light',preset.light);
    document.documentElement.style.setProperty('--scene-dark',preset.dark);
    for (const [panel,image,enabled] of [
      ['.focus-card','.focus-atmosphere',preferences.focusArtwork],
      ['.plan-cover','.plan-atmosphere',preferences.planArtwork],
    ]) {
      const element = document.querySelector(panel);
      const art = element.querySelector(image);
      const showArt = Boolean(preset.image && enabled);
      art.hidden = !showArt;
      if (showArt) art.src = `/images/focus-${preset.image}.webp`;
      element.classList.toggle('is-solid',!showArt);
    }
    overlay.querySelector(`[value="${preset.id}"]`).checked = true;
    focusToggle.checked = preferences.focusArtwork; planToggle.checked = preferences.planArtwork;
    focusToggle.disabled = planToggle.disabled = !preset.image;
    document.getElementById('artwork-note').textContent = preset.image
      ? 'Turn off either image to use its matching solid color.'
      : 'Solid colors apply to both panels. Choose a landscape to enable artwork.';
  };
  const save = () => {
    render();
    try { localStorage.setItem(KEY,JSON.stringify(preferences)); }
    catch { showToast('Appearance applied, but this browser could not save the preference.',true); }
  };
  for (const preset of PRESETS) {
    const label = document.createElement('label'); label.className = `appearance-choice${preset.image ? '' : ' solid-choice'}`;
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'appearance-preset'; radio.value = preset.id;
    radio.addEventListener('change',()=>{ preferences.preset = preset.id; save(); });
    const preview = document.createElement('span'); preview.className = 'appearance-preview'; preview.setAttribute('aria-hidden','true');
    if (preset.image) preview.style.backgroundImage = `url('/images/focus-${preset.image}.webp')`;
    preview.style.setProperty('--swatch-light',preset.light);
    preview.style.setProperty('--swatch-dark',preset.dark);
    const copy = document.createElement('span'); copy.className='appearance-choice-copy'; copy.textContent = preset.name;
    label.append(radio,preview,copy);
    if (preset.note) { const note = document.createElement('small'); note.textContent = preset.note; label.append(note); }
    document.getElementById(preset.image ? 'appearance-landscapes' : 'appearance-colors').append(label);
  }
  focusToggle.addEventListener('change',()=>{preferences.focusArtwork=focusToggle.checked;save();});
  planToggle.addEventListener('change',()=>{preferences.planArtwork=planToggle.checked;save();});
  const close = () => { overlay.classList.add('hidden'); syncDialogs(); trigger.focus(); };
  trigger.addEventListener('click',()=>{overlay.classList.remove('hidden');syncDialogs();document.getElementById('appearance-close').focus();});
  document.getElementById('appearance-close').addEventListener('click',close);
  document.getElementById('appearance-done').addEventListener('click',close);
  document.getElementById('appearance-reset').addEventListener('click',()=>{preferences={...defaults};save();});
  overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
  window.addEventListener('storage',event=>{if(event.key===KEY || event.key===null){preferences=readPreferences();render();}});
  render();
  return { handleKey(event) {
    if(overlay.classList.contains('hidden'))return false;
    if(event.key==='Escape'){event.preventDefault();close();}else trapFocus(event,overlay);
    return true;
  }};
}
