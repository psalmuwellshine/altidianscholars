/* Material saved on this phone for reading without internet. */
import { html, icon, dialog, toast, kindLabel, ago } from '../core/ui.js';
import { list, remove } from '../core/offline.js';
import { emptyState } from './shared.js';

export async function render() {
  const items = list();
  return html`<div class="sec-head"><div><h2>Saved offline</h2><p>These open without internet. Tap "Save offline" on any note or file in the library to add more.</p></div></div>
    ${items.length ? html`<div class="card flat"><ol class="lb">${items.map((m) => html`<li><span class="ico-box">${icon(m.fileId ? 'file' : 'book', 20)}</span><span class="grow"><b>${m.title}</b><br><span class="tiny muted">${m.course} · ${kindLabel[m.kind] || 'Resource'} · saved ${ago(m.savedAt)}</span></span>
      ${m.fileId ? html`<a class="btn primary small" href="/files/${m.fileId}" target="_blank" rel="noopener">${icon('eye', 15)} Open</a>` : ''}${m.note ? html`<button class="btn ${m.fileId ? 'ghost' : 'primary'} small" data-action="saved-read" data-id="${m.id}" type="button">Read notes</button>` : ''}
      <button class="icon-btn small-ic" data-action="saved-del" data-id="${m.id}" type="button" aria-label="Remove ${m.title} from offline">${icon('trash', 15)}</button></li>`)}</ol></div>`
      : emptyState('download', 'Nothing saved yet', 'Open the library and tap "Save offline" on the notes and files you want to keep. They will open even with no data.')}`;
}
export const actions = {
  'saved-read'(el) {
    const m = list().find((x) => x.id === el.dataset.id); if (!m) return;
    dialog(html`<div class="row gap-s wrap-r" style="margin-bottom:10px"><span class="chip">${m.course}</span><span class="chip grey">${kindLabel[m.kind] || 'Resource'}</span></div><h3>${m.title}</h3>
      <div style="white-space:pre-line;margin:12px 0 20px;line-height:1.65">${m.note}</div><div class="row end"><button class="btn ghost small" data-close type="button" autofocus>Close</button></div>`, { wide: true });
  },
  async 'saved-del'(el, ev, { renderView }) { await remove(el.dataset.id); toast('Removed from offline.'); renderView(); },
  async 'save-offline'(el, ev, { S }) {
    const m = S.state.materials.find((x) => x.id === el.dataset.id); if (!m) return;
    const off = await import('../core/offline.js');
    if (off.isSaved(m.id)) { await off.remove(m.id); el.classList.remove('on'); el.textContent = 'Save offline'; toast('Removed from offline.'); return; }
    el.disabled = true; el.textContent = 'Saving…';
    try { await off.save(m); el.classList.add('on'); el.textContent = 'Saved ✓'; toast('Saved. You can read it with no internet.'); } catch (e) { el.textContent = 'Save offline'; toast(e.message, 'bad'); }
    el.disabled = false;
  },
};
