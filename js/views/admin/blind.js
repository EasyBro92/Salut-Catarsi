/* Panel: preparar una Cata a cegues (los vinos de la noche con su solución) */
import { db } from '../../store.js';
import { S, go } from '../../state.js';
import { html, setHtml, on, formData, toast, fmtShortDate } from '../../util.js';
import { t, tMain } from '../../i18n.js';
import { adminTabs } from './ui.js';
import { ATTRS, BLIND, STEP, optionsOf, attrName, solutionFromWine, createBlindSession } from '../../blind.js';

const MODES = ['off', 'free', 'assigned', 'table'];

export default function view({ el, query }) {
  let wines = [], catas = [], items = [], title = '', cataId = query.cata || '', mode = 'off', tables = 4, announce = true, chips = BLIND.startChips, minBet = BLIND.minBet, busy = false;
  const fillTitle = () => { const c = catas.find((x) => x.id === cataId); if (c && !title) title = c.title; };
  const missing = (it) => ATTRS.filter((a) => !it.sol[a.id]).length;

  const wineCard = (it, i) => html`<div class="card mb" data-item="${i}">
    <div class="row between wrap mb"><b class="gold">${t('blind.wine', { i: i + 1, n: items.length })}</b>
      <div class="row"><button type="button" class="btn sm ghost" data-up="${i}">↑</button><button type="button" class="btn sm ghost" data-down="${i}">↓</button><button type="button" class="btn sm ghost" data-rm="${i}">✕</button></div></div>
    <div class="grid c2">
      <label class="field"><span>${t('a.blind.label')}</span><input data-label="${i}" value="${it.label}" maxlength="40" placeholder="${t('a.blind.labelPh', { n: i + 1 })}"></label>
      <label class="field"><span>${t('a.blind.fromWine')}</span><select data-wine="${i}"><option value="">—</option>${[...wines].sort((a, b) => a.name.localeCompare(b.name)).map((w) => html`<option value="${w.id}" ${w.id === it.wineId ? 'selected' : ''}>${w.name}</option>`)}</select></label>
    </div>
    <p class="small muted" style="margin:.2rem 0 .6rem">${t('a.blind.solHint')}</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">${ATTRS.map((a) => html`<label class="field"><span>${a.icon} ${attrName(a.id)} <span class="muted">×${a.mult}</span></span>
      <select data-sol="${i}:${a.id}"><option value="">—</option>${optionsOf(a.id).map((o) => html`<option value="${o.id}" ${o.id === it.sol[a.id] ? 'selected' : ''}>${o.label}</option>`)}</select></label>`)}</div>
    ${missing(it) ? html`<p class="small" style="color:var(--red);margin:.4rem 0 0">${t('a.blind.missing', { n: missing(it) })}</p>` : ''}
  </div>`;

  const render = () => {
    fillTitle();
    setHtml(el, html`${adminTabs('/admin/games')}<a href="#/admin/games" class="muted small">← ${t('a.tab.games')}</a><h1 style="margin-top:.2rem">🍷 ${t('blind.title')}</h1><p class="muted">${t('a.blind.desc')}</p>
      <form class="card" id="bForm">
        <div class="grid c2">
          <label class="field"><span>${t('a.cata.f.title')}</span><input name="title" required value="${title}" placeholder="${t('a.g.titlePh')}"></label>
          <label class="field"><span>${t('a.g.cata')}</span><select name="cataId"><option value="">—</option>${[...catas].sort((a, b) => b.startsAt - a.startsAt).map((c) => html`<option value="${c.id}" ${c.id === cataId ? 'selected' : ''}>${c.title} · ${fmtShortDate(c.startsAt)}</option>`)}</select></label>
        </div>
        <div class="grid c2">
          <label class="field"><span>${t('game.teams')}</span><select name="mode">${MODES.map((k) => html`<option value="${k}" ${mode === k ? 'selected' : ''}>${t('a.g.mode.' + k)}</option>`)}</select></label>
          ${mode === 'table' ? html`<label class="field"><span>${t('a.g.tables')}</span><input type="number" name="tables" min="2" max="30" value="${tables}"></label>` : ''}
        </div>
        <div class="grid c2">
          <label class="field"><span>🪙 ${t('a.blind.chips')}</span><input type="number" name="chips" min="${STEP * 4}" max="1000" step="${STEP}" value="${chips}"></label>
          <label class="field"><span>⚖️ ${t('a.blind.minBet')}</span><input type="number" name="minBet" min="0" max="200" step="${STEP}" value="${minBet}"></label>
        </div>
        <label class="check mb"><input type="checkbox" name="announce" ${announce ? 'checked' : ''}><span>${t('a.g.announce')}</span></label>
        <h3>${t('a.blind.winesTitle')} <span class="muted small">(${items.length})</span></h3>
        ${items.length ? items.map(wineCard) : html`<p class="muted small">${t('a.blind.noWines')}</p>`}
        <button type="button" class="btn" data-act="add">＋ ${t('a.blind.addWine')}</button>
        <button class="btn primary block mt" ${busy || !items.length ? 'disabled' : ''}>${t('a.g.create')}</button>
      </form>`);
  };
  const keep = () => { const f = el.querySelector('#bForm'); if (f) { const d = formData(f); title = d.title ?? title; cataId = d.cataId ?? cataId; mode = d.mode ?? mode; tables = d.tables ?? tables; announce = !!d.announce; chips = Number(d.chips) || chips; minBet = d.minBet === '' ? minBet : Number(d.minBet); } };
  const move = (i, d) => { keep(); const j = i + d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; render(); };

  const subs = [db.onList('wines', {}, (l) => { wines = l; render(); }), db.onList('catas', {}, (l) => { catas = l; render(); })];
  const offs = [
    on(el, 'click', '[data-act="add"]', () => { keep(); items.push({ label: '', wineId: '', sol: {} }); render(); }),
    on(el, 'click', '[data-up]', (e, b) => move(Number(b.dataset.up), -1)),
    on(el, 'click', '[data-down]', (e, b) => move(Number(b.dataset.down), 1)),
    on(el, 'click', '[data-rm]', (e, b) => { keep(); items.splice(Number(b.dataset.rm), 1); render(); }),
    on(el, 'input', '[data-label]', (e, i) => { items[Number(i.dataset.label)].label = i.value; }),
    on(el, 'change', '[data-wine]', (e, sel) => {
      keep(); const it = items[Number(sel.dataset.wine)], w = wines.find((x) => x.id === sel.value);
      it.wineId = sel.value;
      if (w) it.sol = { ...it.sol, ...solutionFromWine(w) };   // la etiqueta NO se rellena con el nombre del vino: los participantes la ven y es a ciegas
      render();
    }),
    on(el, 'change', '[data-sol]', (e, sel) => {
      const [i, id] = sel.dataset.sol.split(':'), it = items[Number(i)];
      if (sel.value) it.sol[id] = sel.value; else delete it.sol[id];
      const card = el.querySelector(`[data-item="${i}"]`); // el aviso de «faltan N» se rehace sin tocar los desplegables
      const m = missing(it), old = card.querySelector('[data-miss]');
      if (old) old.remove();
      if (m) { const p = document.createElement('p'); p.className = 'small'; p.dataset.miss = '1'; p.style.cssText = 'color:var(--red);margin:.4rem 0 0'; p.textContent = t('a.blind.missing', { n: m }); card.appendChild(p); }
    }),
    on(el, 'change', '[name=mode],[name=cataId]', (e, s) => { const prev = cataId; keep(); if (s.name === 'cataId' && cataId && cataId !== prev) { const c = catas.find((x) => x.id === cataId); if (c) title = c.title; } render(); }),
    on(el, 'submit', '#bForm', async (e) => {
      e.preventDefault(); keep(); busy = true; render();
      try {
        const tb = mode === 'table' ? Array.from({ length: tables || 4 }, (_, i) => tMain('a.g.table', { n: i + 1 })) : [];
        const list = items.map((it, i) => ({ label: it.label.trim() || tMain('blind.wineN', { n: i + 1 }), wineId: it.wineId, sol: it.sol }));
        const { sid } = await createBlindSession({ title, cataId, wines: list, teamMode: mode, tables: tb, createdBy: S.user.uid, announce, startChips: chips, minBet });
        go('/admin/run/' + sid);
      } catch (ex) { console.error(ex); toast(t('a.g.createErr'), 'err'); busy = false; render(); }
    }),
  ];
  render();
  return () => { subs.forEach((f) => f()); offs.forEach((f) => f()); };
}
