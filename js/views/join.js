/* Unirse a una partida: código o QR → apodo → equipo */
import { db, auth } from '../store.js';
import { S, go, loggedIn, myNick } from '../state.js';
import { t } from '../i18n.js';
import { CONFIG } from '../config.js';
import { html, setHtml, on, formData, skeleton, modal } from '../util.js';
import { findSessionByCode, joinSession, addTeam } from '../game.js';
import { icon } from '../icons.js';

export default function view({ el, params, query }) {
  let code = (params.code || '').toUpperCase(), sess = null, teams = [], err = '', busy = false, state = code ? 'loading' : 'code', draft = {};
  let unTeams = () => {};
  const guestNick = () => { try { return localStorage.getItem('catas_guest_nick') || ''; } catch { return ''; } };

  const renderCode = () => setHtml(el, html`<div class="center mb"><span class="big-ic">${icon('dice', 34, 1.3)}</span><h1>${t('join.title')}</h1><p class="muted">${t('join.intro')}</p></div>
    <form class="card center" id="codeForm">${err ? html`<div class="err">${err}</div>` : ''}
      <label class="field"><span>${t('join.code')}</span><input name="code" maxlength="6" autocomplete="off" autocapitalize="characters" required style="text-align:center;font-size:2rem;letter-spacing:.3em;text-transform:uppercase" value="${code}"></label>
      <button class="btn primary block" ${busy ? 'disabled' : ''}>${t('join.go')}</button></form>
    <a class="card tr-entry" href="#/trivial"><span class="tr-entry-ic">${icon('crown', 26, 1.5)}</span><span class="grow"><b>${t('trivial.title')}</b><small>${t('trivial.tag')}</small></span>${icon('right', 20)}</a>
    <button type="button" class="card tr-entry" data-act="blind-info"><span class="tr-entry-ic">${icon('glass', 26, 1.5)}</span><span class="grow"><b>${t('blind.title')}</b><small>${t('blind.tag')} · ${t('blind.live')}</small></span>${icon('right', 20)}</button>`);

  const renderForm = () => {
    const mode = sess.teamMode;
    const p = S.profile || {};
    const nick = draft.nick || myNick() || guestNick();
    setHtml(el, html`<div class="center mb"><span class="big-ic">${icon('glass', 34, 1.3)}</span><h1>${sess.title}</h1></div>
      <form class="card" id="joinForm">
        ${err ? html`<div class="err">${err}</div>` : ''}
        <label class="field"><span>${t('f.nick')}</span><input name="nick" required maxlength="18" value="${nick}" placeholder="${t('join.nickPh')}"></label>
        ${mode === 'free' ? html`<label class="field"><span>${t('join.team')}</span><select name="team"><option value="">${t('join.noTeam')}</option>${teams.map((x) => html`<option value="${x.id}">${x.name}</option>`)}<option value="__new">＋ ${t('join.newTeam')}</option></select></label><label class="field hide" id="newTeamBox"><span>${t('join.teamName')}</span><input name="newTeam" maxlength="24"></label>` : ''}
        ${mode === 'table' ? html`<label class="field"><span>${t('join.tableCode')}</span><input name="table" maxlength="6" style="text-transform:uppercase" value="${draft.table ?? (query.mesa || '')}" placeholder="${t('join.tablePh')}"></label>` : ''}
        ${mode === 'assigned' ? html`<p class="muted small">${t('join.assigned')}</p>` : ''}
        ${p.adult ? '' : html`<label class="check"><input type="checkbox" name="adult" required ${draft.adult ? 'checked' : ''}><span>${t('age.confirm', { n: CONFIG.minAge })}</span></label>`}
        ${loggedIn() ? html`<p class="hint">${icon('trophy', 15)} ${t('join.saved')}</p>` : html`<p class="hint">${t('join.guest')} <a href="#/login?next=${encodeURIComponent('/join/' + code)}">${t('auth.login')}</a></p>`}
        <button class="btn primary block" ${busy ? 'disabled' : ''}>${t('join.enter')}</button>
      </form>`);
  };

  const lookup = async () => {
    if (!auth.current) { await auth.anonymous(); return; }   // al iniciar sesión la app vuelve a cargar esta pantalla
    try {
      sess = await findSessionByCode(code);
      if (!sess) { err = t('join.notfound'); state = 'code'; return renderCode(); }
      const ex = await db.get(`sessions/${sess.id}/players/${auth.current.uid}`);
      if (ex) { go((sess.mode === 'blind' ? '/bgame/' : '/game/') + sess.id); return; }
      unTeams = db.onList(`sessions/${sess.id}/teams`, {}, (l) => { teams = l; if (state === 'form') { const f = el.querySelector('#joinForm'); const keep = f ? formData(f) : null; renderForm(); const nf = el.querySelector('#joinForm'); if (nf && keep) { for (const k of ['nick', 'team', 'newTeam', 'table']) if (nf.elements[k] && keep[k] != null) nf.elements[k].value = keep[k]; nf.elements.team && nf.elements.team.dispatchEvent(new Event('change', { bubbles: true })); } } });
      state = 'form'; renderForm();
    } catch (e) { console.error(e); err = t('err.generic'); state = 'code'; renderCode(); }
  };

  // la Cata a cegues se juega en directo en una cata: aquí solo se explica y se lleva al campo del código
  const blindInfo = () => {
    const m = modal(html`<h3>🍷 ${t('blind.title')}</h3><p class="muted">${t('blind.how.intro')}</p>
      <ol class="how">${[1, 2, 3, 4].map((n) => html`<li>${t('blind.how.' + n)}</li>`)}</ol>
      <button class="btn primary block mt" data-go>${t('blind.how.code')}</button><button class="btn ghost block mt" data-close>${t('common.back')}</button>`);
    m.el.querySelector('[data-go]').addEventListener('click', () => { m.close(); const i = el.querySelector('[name=code]'); if (i) { i.scrollIntoView({ block: 'center', behavior: 'smooth' }); i.focus(); } });
  };
  const offs = [
    on(el, 'click', '[data-act="blind-info"]', blindInfo),
    on(el, 'submit', '#codeForm', (e) => { e.preventDefault(); const c = formData(e.target).code.toUpperCase().trim(); if (c) go('/join/' + c); }),
    on(el, 'change', '[name=team]', (e, s) => { el.querySelector('#newTeamBox')?.classList.toggle('hide', s.value !== '__new'); }),
    on(el, 'submit', '#joinForm', async (e) => {
      e.preventDefault(); const f = formData(e.target); draft = { nick: f.nick, table: f.table, adult: !!f.adult }; busy = true; err = '';
      try {
        const uid = auth.current.uid; let teamId = '';
        if (sess.teamMode === 'free') {
          if (f.team === '__new') { if (!f.newTeam) throw new Error('team'); teamId = await addTeam(sess.id, f.newTeam, 'free'); } else teamId = f.team || '';
        } else if (sess.teamMode === 'table' && f.table) {
          const tb = teams.find((x) => (x.code || '').toUpperCase() === f.table.toUpperCase());
          if (!tb) throw new Error('table'); teamId = tb.id;
        }
        if (loggedIn() && !S.profile?.adult && f.adult) await db.update(`users/${uid}`, { adult: true });
        try { localStorage.setItem('catas_guest_nick', f.nick); } catch { /* nada */ }
        await joinSession(sess.id, uid, { nick: f.nick, teamId, registered: loggedIn(), adult: true, lang: S.lang });
        go((sess.mode === 'blind' ? '/bgame/' : '/game/') + sess.id);
      } catch (ex) { console.error(ex); err = ex.message === 'table' ? t('join.badTable') : ex.message === 'team' ? t('join.teamName') : t('err.generic'); busy = false; renderForm(); }
    }),
  ];
  if (state === 'code') renderCode(); else { setHtml(el, skeleton('rows')); lookup(); }
  return () => { offs.forEach((f) => f()); unTeams(); };
}
