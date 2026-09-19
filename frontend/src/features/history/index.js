import { api } from '../../shared/api';
export function initHistory({ showToast, refresh }) {
  let cursor = null, deleted = false, loading = false, generation = 0;
  const history = document.getElementById('history-view');
  const more = document.getElementById('history-more');
  const toggle = document.getElementById('history-deleted');
  async function loadHistory(append = false) {
    if (append && loading) return;
    const request = ++generation;
    loading = true; more.disabled = true;
    try {
      const sessions = await api(`/sessions?limit=30&deleted=${deleted}${append && cursor ? `&before_id=${cursor}` : ''}`);
      if (request !== generation) return;
      if (!append) history.replaceChildren();
      sessions.forEach(session => {
        const node = document.getElementById('session-template').content.cloneNode(true);
        node.querySelector('.session-title').textContent = session.task_title;
        const summary = node.querySelector('.session-summary-note');
        summary.textContent = session.summary || ''; summary.hidden = !session.summary;
        const attributions = node.querySelector('.session-attributions');
        for (const item of session.attributions) {
          const label = document.createElement('span'); label.textContent = `${item.completed ? 'Finished' : 'Worked on'}: ${item.task_title}`; attributions.appendChild(label);
        }
        if (!session.attributions.length) attributions.textContent = 'General focus';
        node.querySelector('.session-status').textContent = deleted ? 'Deleted' : 'Focus ritual';
        const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(session.created_at) ? session.created_at : `${session.created_at}Z`);
        node.querySelector('.session-meta').textContent = `${session.actual_minutes} minutes focused · ${date.toLocaleString()}`;
        const button = node.querySelector('.session-delete');
        button.className = 'text-btn'; button.textContent = deleted ? 'Restore' : 'Delete';
        button.setAttribute('aria-label', `${deleted ? 'Restore' : 'Delete'} ${session.task_title}`);
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            if (deleted) {
              await api(`/sessions/${session.id}/restore`, {method:'POST'});
              await loadHistory(); showToast('Focus record restored.');
            } else {
              await api(`/sessions/${session.id}`, {method:'DELETE'});
              await loadHistory();
              showToast('Focus record deleted.', false, {label:'Undo', run:async () => {
                await api(`/sessions/${session.id}/restore`, {method:'POST'}); await loadHistory(); await refresh();
              }});
            }
            await refresh();
          } catch(error) { button.disabled = false; showToast(error.message, true); }
        });
        history.appendChild(node);
      });
      cursor = sessions.at(-1)?.id ?? null;
      more.classList.toggle('hidden', sessions.length < 30);
      if (!history.children.length) {
        const empty = document.createElement('p'); empty.className='page-description'; empty.textContent=deleted ? 'No deleted records.' : 'No focus rituals saved yet.'; history.appendChild(empty);
      }
    } finally { if (request === generation) { loading = false; more.disabled = false; } }
  }
  more.addEventListener('click', () => loadHistory(true));
  toggle.addEventListener('click', () => { deleted = !deleted; toggle.setAttribute('aria-pressed',String(deleted)); toggle.textContent=deleted ? 'Show saved records' : 'Show deleted records'; loadHistory(); });
  return { loadHistory };
}
