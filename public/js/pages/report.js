// "Report a problem": students flag a wrong answer, a broken file or anything on the site.
import { html, icon, api, toast, dialog } from '../core/ui.js';

const REASONS = {
  question: [['wrong-answer', 'The answer is wrong'], ['typo', 'Spelling or typing mistake'], ['unclear', 'The question is unclear'], ['other', 'Something else']],
  material: [['broken-file', 'The file will not open'], ['wrong-answer', 'Wrong information'], ['unclear', 'Hard to read or unclear'], ['other', 'Something else']],
  site: [['other', 'Something is not working'], ['unclear', 'I am confused about something'], ['typo', 'A spelling mistake']],
};
export const reasonLabel = (r) => ({ 'wrong-answer': 'Wrong answer', typo: 'Typo', unclear: 'Unclear', 'broken-file': 'Broken file', other: 'Other' }[r] || r);

export const reportButton = (type, refId, qIndex) => html`<button class="btn ghost small rep-btn" data-action="report-open" data-type="${type}" data-ref="${refId || ''}" data-q="${qIndex === undefined ? '' : qIndex}" type="button" title="Report a problem">${icon('flag', 14)} Report</button>`;

export const actions = {
  'report-open'(el, ev, { user }) {
    if (!user()) { location.hash = '#/login'; return; }
    const type = el.dataset.type;
    const title = type === 'question' ? 'Report a problem with this question' : type === 'material' ? 'Report a problem with this resource' : 'Report a problem';
    const { box, close } = dialog(html`<h3>${title}</h3>
      <form data-submit="report-send" novalidate>
        <input type="hidden" name="type" value="${type}"><input type="hidden" name="refId" value="${el.dataset.ref}"><input type="hidden" name="qIndex" value="${el.dataset.q}">
        <label class="field"><span>What is wrong?</span><select name="reason">${REASONS[type].map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></label>
        <label class="field"><span>Tell us a little more</span><textarea name="message" rows="4" maxlength="500" required placeholder="For example: the correct answer should be C because..." autofocus></textarea></label>
        <div class="row end gap-s" style="margin-top:14px"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Send report</button></div>
      </form>`);
    box._close = close; window.__reportClose = close;
  },
  async 'report-send'(form) {
    const f = new FormData(form); const b = Object.fromEntries(f.entries());
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try {
      await api('POST', '/api/report', { type: b.type, refId: b.refId || undefined, qIndex: b.qIndex === '' ? undefined : Number(b.qIndex), reason: b.reason, message: b.message });
      toast('Thank you. We will look into it.');
      if (window.__reportClose) window.__reportClose();
    } catch (e) { btn.disabled = false; toast(e.message, 'bad'); }
  },
};
