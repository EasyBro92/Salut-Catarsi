/* Cata a cegues: partida en directo de apuestas con fichas.
   Cada vino pasa por tres momentos: se cata (a ciegas), se apuesta y se revela. Al apostar, cada jugador elige una respuesta
   en siete rasgos del vino y pone fichas a las que de verdad cree. Si acierta, la ficha vale varias veces; si falla, se pierde.
   Gana quien acaba con más fichas; si empatan, quien tiene más aciertos.
   Reutiliza la infraestructura de las partidas de preguntas (sala con código y QR, presentador, pantalla grande, equipos y ranking):
   la sesión lleva `mode: 'blind'` y la solución de cada vino vive en `qs/{i}`, que solo lee el equipo. */
import { db } from './store.js';
import { t } from './i18n.js';
import { clamp, joinCode, rid } from './util.js';
import { TEAM_COLORS, findSessionByCode, endSession } from './game.js';

const sp = (sid) => `sessions/${sid}`;
export const STEP = 5;                                  // las fichas se apuestan de cinco en cinco: así las cuentas son siempre redondas
export const BLIND = { startChips: 100, minBet: 10 };

// ---------- los siete rasgos y lo que se puede elegir en cada uno ----------
// `mult` = cuántas veces vale la ficha si se acierta. Va según lo difícil que es acertar: la uva y la D.O. pagan más que el precio.
export const ATTRS = [
  { id: 'grape', icon: '🍇', mult: 5 }, { id: 'do', icon: '📍', mult: 4 }, { id: 'vintage', icon: '📅', mult: 4 },
  { id: 'abv', icon: '🌡️', mult: 3 }, { id: 'aging', icon: '🛢️', mult: 3 }, { id: 'comp', icon: '🧬', mult: 2 }, { id: 'price', icon: '💶', mult: 2 },
];
const GRAPES = ['Garnatxa negra', 'Garnatxa blanca', 'Carinyena', 'Tempranillo / Ull de llebre', 'Monastrell', 'Mencía', 'Bobal', 'Syrah', 'Cabernet sauvignon', 'Merlot', 'Pinot noir', 'Sumoll', 'Trepat',
  'Cabernet franc', 'Xarel·lo', 'Macabeu', 'Parellada', 'Chardonnay', 'Sauvignon blanc', 'Verdejo', 'Albariño', 'Godello', 'Malvasia', 'Riesling', 'Gewürztraminer', 'Moscatell', 'Pedro Ximénez', 'Palomino', 'Picapoll', 'Altres'];
const DOS = ['DOQ Priorat', 'DO Montsant', 'DO Penedès', 'DO Cava', 'DO Empordà', 'DO Costers del Segre', 'DO Terra Alta', 'DO Conca de Barberà', 'DO Pla de Bages', 'DO Alella', 'DO Tarragona', 'DO Catalunya',
  'DOCa Rioja', 'DO Ribera del Duero', 'DO Rueda', 'DO Rías Baixas', 'DO Bierzo', 'DO Toro', 'DO Jumilla', 'DO Navarra', 'DO Somontano', 'DO Jerez-Xérès-Sherry', 'DO La Mancha', 'DO Valdepeñas', 'DO Utiel-Requena',
  'DO València', 'DO Alicante', 'DO Yecla', 'DO Campo de Borja', 'DO Cariñena', 'DO Calatayud', 'DO Ribeiro', 'DO Valdeorras', 'DO Txakoli', 'Altres'];
const ABV = [['abv1', '< 11,5 %'], ['abv2', '11,5 – 12,5 %'], ['abv3', '12,5 – 13,5 %'], ['abv4', '13,5 – 14,5 %'], ['abv5', '> 14,5 %']];
const PRICE = [['p1', '≤ 8 €'], ['p2', '8 – 15 €'], ['p3', '15 – 30 €'], ['p4', '> 30 €']];
const COMP = ['mono', 'blend2', 'blend3'];
const AGING = ['none', 'short', 'crianza', 'reserva', 'gran'];

/** Opciones de un rasgo como [{ id, label }]. En uva, D.O., añada, graduación y precio el texto es el mismo en todos los idiomas. */
export function optionsOf(attr) {
  if (attr === 'grape') return GRAPES.map((g) => ({ id: g, label: g }));
  if (attr === 'do') return DOS.map((d) => ({ id: d, label: d }));
  if (attr === 'vintage') { const y = new Date().getFullYear(); return Array.from({ length: 31 }, (_, i) => ({ id: String(y - i), label: String(y - i) })); }
  if (attr === 'abv') return ABV.map(([id, label]) => ({ id, label }));
  if (attr === 'price') return PRICE.map(([id, label]) => ({ id, label }));
  if (attr === 'comp') return COMP.map((id) => ({ id, label: t('blind.comp.' + id) }));
  return AGING.map((id) => ({ id, label: t('blind.aging.' + id) }));
}
export const optionLabel = (attr, id) => (id ? optionsOf(attr).find((o) => o.id === id)?.label ?? id : '—');
export const attrName = (id) => t('blind.attr.' + id);

/** Banda de graduación a la que cae un valor como «14,5». */
export function abvBand(v) {
  const n = parseFloat(String(v).replace(',', '.')); if (!Number.isFinite(n)) return '';
  return n < 11.5 ? 'abv1' : n < 12.5 ? 'abv2' : n < 13.5 ? 'abv3' : n < 14.5 ? 'abv4' : 'abv5';
}

/** Rellena lo que se pueda de la solución a partir de un vino del catálogo. Es una ayuda: el presentador lo revisa. */
export function solutionFromWine(w) {
  const a = w?.attrs || {}, norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const sol = {};
  const grape = GRAPES.find((g) => norm(a.variety).includes(norm(g.split(' / ')[0]).replace('garnatxa negra', 'garnatxa'))) || '';
  if (grape) sol.grape = grape;
  const dd = DOS.find((d) => a.origin && norm(d).includes(norm(a.origin))); if (dd) sol.do = dd;
  if (OKYEAR(a.vintage)) sol.vintage = String(a.vintage).trim();
  const band = abvBand(a.abv); if (band) sol.abv = band;
  if (a.variety) sol.comp = /[,/+]| i | y /.test(a.variety) ? (a.variety.split(/[,/+]| i | y /).filter(Boolean).length >= 3 ? 'blend3' : 'blend2') : 'mono';
  const txt = norm((a.aging || '') + ' ' + (a.wood || ''));
  if (txt.trim()) {
    const m = txt.match(/(\d+)\s*mes/);
    sol.aging = /sense|sin |acer|inox/.test(txt) && !m ? 'none' : !m ? 'crianza' : +m[1] < 6 ? 'short' : +m[1] < 18 ? 'crianza' : +m[1] < 36 ? 'reserva' : 'gran';
  }
  return sol;
}
const OKYEAR = (v) => /^\d{4}$/.test(String(v || '').trim()) && optionsOf('vintage').some((o) => o.id === String(v).trim());

// ---------- cuentas ----------
export const chipsOf = (player, s) => (s?.startChips ?? BLIND.startChips) + (player?.score || 0);
/** Los jugadores con su banco de fichas en `score` (lo que enseñan las listas y el podio). */
export const withChips = (players, s) => players.map((p) => ({ ...p, score: chipsOf(p, s) }));

/** Resultado de una apuesta contra la solución. Función pura: la usa el presentador al revelar y el participante para enseñarse el desglose.
 *  Sin respuesta elegida no hay apuesta; lo apostado nunca pasa del banco; si no llega al mínimo, se pierde lo que falta (sin pasar de lo que queda). */
export function scoreBet(bet, sol, bank, minBet = 0) {
  const picks = bet?.picks || {}, asked = bet?.chips || {};
  let left = Math.max(0, bank), spent = 0, gain = 0, hits = 0; const hit = {}, chips = {};
  for (const a of ATTRS) {
    const pick = picks[a.id];
    const c = pick ? clamp(Math.floor(Number(asked[a.id]) || 0), 0, left) : 0;
    chips[a.id] = c; left -= c; spent += c;
    const ok = !!pick && String(pick) === String(sol?.[a.id]);
    hit[a.id] = ok; if (ok) { hits++; gain += c * a.mult; }
  }
  const penalty = Math.max(0, Math.min(minBet - spent, left));
  const delta = Math.max(gain - spent - penalty, -Math.max(0, bank));
  return { spent, gain, hits, penalty, delta, hit, chips };
}

// ---------- crear y llevar la partida ----------
/** Crea la partida. `wines` = [{ label, wineId, sol: { grape, do, vintage, abv, aging, comp, price } }]. */
export async function createBlindSession({ title, cataId, wines, teamMode, tables = [], createdBy, announce = true, startChips = BLIND.startChips, minBet = BLIND.minBet }) {
  let code = joinCode(4);
  for (let i = 0; i < 15; i++) { const ex = await findSessionByCode(code); if (!ex) break; code = joinCode(4); }
  const sid = rid();
  const ops = [['set', sp(sid), { code, title, cataId: cataId || '', createdBy, createdAt: db.ts(), status: 'lobby', announce: !!announce, teamMode, mode: 'blind', nWines: wines.length, total: wines.length * ATTRS.length,
    startChips, minBet, qIndex: -1, cur: null, reveal: null, final: null, answeredCount: 0 }]];
  wines.forEach((w, i) => ops.push(['set', `${sp(sid)}/qs/${i}`, { index: i, label: w.label || `Vi ${i + 1}`, wineId: w.wineId || '', sol: w.sol }]));
  tables.forEach((name, i) => ops.push(['set', `${sp(sid)}/teams/t${i + 1}`, { name, color: TEAM_COLORS[i % TEAM_COLORS.length], code: joinCode(3), kind: 'table', createdAt: db.ts() }]));
  await db.batch(ops);
  return { sid, code };
}

/** Abre un vino: los jugadores ya pueden apostar. */
export async function startBlindWine(sid, index) {
  const q = await db.get(`${sp(sid)}/qs/${index}`);
  if (!q) throw new Error('no-wine');
  await db.update(sp(sid), { status: 'question', qIndex: index, reveal: null, answeredCount: 0, cur: { index, label: q.label, open: true, openedAt: Date.now() } });
}

/** El participante guarda (o corrige) su apuesta mientras el vino está abierto. */
export async function saveBet(sid, uid, index, { picks, chips, stars, done }) {
  await db.set(`${sp(sid)}/bets/${index}_${uid}`, { uid, index, picks, chips, stars: stars || 0, done: !!done, at: db.ts() });
}

/** Pasa al vino siguiente o, si era el último, cierra la partida. */
export async function nextOrEndBlind(sid) {
  const s = await db.get(sp(sid));
  if (!s) return;
  if (s.qIndex + 1 >= s.nWines) return endSession(sid);
  return startBlindWine(sid, s.qIndex + 1);
}

const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

/** Cierra las apuestas, reparte las fichas y enseña la solución. */
export async function revealBlind(sid) {
  const s = await db.get(sp(sid));
  if (!s || s.status !== 'question' || !s.cur) return;
  const i = s.cur.index;
  const [q, bets, players] = await Promise.all([db.get(`${sp(sid)}/qs/${i}`), db.list(`${sp(sid)}/bets`, { where: [['index', '==', i]] }), db.list(`${sp(sid)}/players`)]);
  const byUid = new Map(bets.map((b) => [b.uid, b]));
  const hits = Object.fromEntries(ATTRS.map((a) => [a.id, 0]));
  let nBets = 0, starSum = 0, starN = 0; const ops = [];
  for (const p of players) {
    const b = byUid.get(p.id);
    const r = scoreBet(b, q.sol, chipsOf(p, s), s.minBet ?? 0);
    if (b) { nBets++; if (b.stars >= 1 && b.stars <= 5) { starSum += b.stars; starN++; } }
    ATTRS.forEach((a) => { if (r.hit[a.id]) hits[a.id]++; });
    ops.push(['update', `${sp(sid)}/players/${p.id}`, { score: db.inc(r.delta), correct: db.inc(r.hits), answered: db.inc(1), lastPts: r.delta, lastOk: r.hits > 0 }]);
    if (b) ops.push(['update', `${sp(sid)}/bets/${b.id}`, { res: { delta: r.delta, hits: r.hits, spent: r.spent, penalty: r.penalty } }]);
  }
  for (const part of chunk(ops, 400)) await db.batch(part);
  await db.update(sp(sid), { status: 'reveal', 'cur.open': false, reveal: { index: i, label: q.label, sol: q.sol, hits, nBets, avgStars: starN ? Math.round((starSum / starN) * 10) / 10 : 0 } });
}
