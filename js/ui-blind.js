/* Piezas visuales de la Cata a cegues: el formulario de apuestas, el desglose al revelar y la solución */
import { html } from './util.js';
import { t } from './i18n.js';
import { ATTRS, STEP, attrName, optionsOf, optionLabel } from './blind.js';

/** Fichas puestas de verdad: solo cuentan las de los rasgos con respuesta elegida. */
export const spentOf = (chips, picks) => ATTRS.reduce((a, x) => a + (picks[x.id] ? (chips[x.id] || 0) : 0), 0);

/** Borrador listo para guardar: sin rasgos vacíos, fichas de STEP en STEP y sin pasarse del banco. */
export function cleanDraft(draft, bank) {
  const picks = {}, chips = {}; let left = Math.max(0, bank);
  for (const a of ATTRS) {
    const p = draft.picks[a.id]; if (!p) continue;
    const c = Math.min(left, Math.max(0, Math.floor((draft.chips[a.id] || 0) / STEP) * STEP));
    picks[a.id] = p; chips[a.id] = c; left -= c;
  }
  return { picks, chips, stars: draft.stars || 0 };
}

export const fmtDelta = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);

const stars = (n) => html`<div class="stars">${[1, 2, 3, 4, 5].map((i) => html`<button type="button" data-bstar="${i}" class="${i <= n ? 'on' : ''}" aria-label="${i}">⭐</button>`)}</div>`;

/** Formulario de apuestas del participante. Se rehace solo al abrir un vino; después se retoca en su sitio con `patchBet`. */
export function betForm(draft, bank, minBet) {
  return html`<p class="muted small" style="margin-top:0">${t('blind.intro')}</p>
    <div class="bet-list">${ATTRS.map((a) => {
      const pick = draft.picks[a.id] || '';
      return html`<div class="bet-row ${pick ? 'on' : ''}" data-row="${a.id}">
        <div class="bet-h"><span class="bet-ic" aria-hidden="true">${a.icon}</span><b>${attrName(a.id)}</b><span class="pill gold">×${a.mult}</span></div>
        <select data-pick="${a.id}" aria-label="${attrName(a.id)}"><option value="">${t('blind.noBet')}</option>${optionsOf(a.id).map((o) => html`<option value="${o.id}" ${o.id === pick ? 'selected' : ''}>${o.label}</option>`)}</select>
        <div class="stepper"><button type="button" data-chip="${a.id}" data-d="-1" aria-label="−" ${pick ? '' : 'disabled'}>−</button><output data-chipval="${a.id}">🪙 ${pick ? draft.chips[a.id] || 0 : 0}</output><button type="button" data-chip="${a.id}" data-d="1" aria-label="+" ${pick ? '' : 'disabled'}>+</button></div>
      </div>`;
    })}</div>
    <div class="card mt"><b>${t('blind.rate')}</b>${stars(draft.stars || 0)}</div>
    <div class="sticky-actions"><p class="small muted center" data-betnote></p><button class="btn primary block" data-act="bet">${t('blind.bet')}</button></div>`;
}

/** Actualiza en su sitio lo que depende de las fichas, sin rehacer los desplegables (en el móvil perderían el foco). */
export function patchBet(root, draft, bank, minBet) {
  const spent = spentOf(draft.chips, draft.picks), left = bank - spent;
  for (const a of ATTRS) {
    const pick = draft.picks[a.id], c = pick ? draft.chips[a.id] || 0 : 0;
    const row = root.querySelector(`[data-row="${a.id}"]`); if (!row) continue;
    row.classList.toggle('on', !!pick);
    row.querySelector(`[data-chipval="${a.id}"]`).textContent = '🪙 ' + c;
    const [minus, plus] = row.querySelectorAll('[data-chip]');
    minus.disabled = !pick || c <= 0; plus.disabled = !pick || left < STEP;
  }
  const note = root.querySelector('[data-betnote]');
  if (note) {
    note.textContent = t('blind.left', { n: left, bank }) + (spent < minBet ? ' · ' + t('blind.min', { n: minBet }) : '');
    note.classList.toggle('warn-txt', spent < minBet);
  }
  root.querySelectorAll('[data-bstar]').forEach((b) => b.classList.toggle('on', Number(b.dataset.bstar) <= (draft.stars || 0)));
}

/** Apuesta ya enviada: lo que se ha elegido y cuánto se juega en cada rasgo. */
export const sealedList = (bet) => html`<div class="bet-list">${ATTRS.filter((a) => bet?.picks?.[a.id]).map((a) => html`<div class="rv-row sealed"><span class="bet-ic" aria-hidden="true">${a.icon}</span><div class="grow"><div class="small muted">${attrName(a.id)}</div><b>${optionLabel(a.id, bet.picks[a.id])}</b></div><span class="pill gold">🪙 ${bet.chips?.[a.id] || 0}</span></div>`)}</div>`;

/** Desglose al revelar para quien ha apostado. `r` es lo que devuelve scoreBet; `hits` y `nBets` dicen cuántos acertaron cada rasgo. */
export function revealList({ sol, bet, r, hits = {}, nBets = 0 }) {
  return html`<div class="bet-list">${ATTRS.map((a) => {
    const pick = bet?.picks?.[a.id], c = r?.chips?.[a.id] || 0, ok = r?.hit?.[a.id];
    const net = ok ? c * (a.mult - 1) : -c;
    return html`<div class="rv-row ${!pick ? 'none' : ok ? 'ok' : 'bad'}"><span class="bet-ic" aria-hidden="true">${a.icon}</span>
      <div class="grow"><div class="small muted">${attrName(a.id)}</div><b>${optionLabel(a.id, sol?.[a.id])}</b>
        <div class="small">${pick ? html`${ok ? '✓' : '✗'} ${optionLabel(a.id, pick)}` : html`<span class="muted">${t('blind.noPick')}</span>`} <span class="muted">· ${t('blind.guessed', { a: hits[a.id] || 0, n: nBets })}</span></div></div>
      ${pick ? html`<span class="rv-net ${net > 0 ? 'up' : net < 0 ? 'down' : ''}">${c ? fmtDelta(net) : '0'}</span>` : ''}</div>`;
  })}${r?.penalty ? html`<div class="rv-row bad"><span class="bet-ic" aria-hidden="true">⚖️</span><div class="grow"><b>${t('blind.penalty')}</b><div class="small muted">${t('blind.penaltyNote')}</div></div><span class="rv-net down">−${r.penalty}</span></div>` : ''}</div>`;
}

/** Solución del vino y cuánta gente la acertó (presentador y pantalla grande). */
export const solutionList = ({ sol, hits = {}, nBets = 0 }, { big = false } = {}) => html`<div class="bet-list ${big ? 'big' : ''}">${ATTRS.map((a) => html`<div class="rv-row ok"><span class="bet-ic" aria-hidden="true">${a.icon}</span><div class="grow"><div class="small muted">${attrName(a.id)} · ×${a.mult}</div><b>${optionLabel(a.id, sol?.[a.id])}</b></div><span class="pill">${hits[a.id] || 0}/${nBets}</span></div>`)}</div>`;
