/* Cata a cegues · pantalla del participante: apostar fichas en cada rasgo del vino y ver cómo se mueve el ranking al revelarlo */
import { db, auth } from '../store.js';
import { go, loggedIn } from '../state.js';
import { t } from '../i18n.js';
import { html, setHtml, on, toast, sfx, isMuted, setMuted, confetti, celebrate, countUp, formData, skeleton } from '../util.js';
import { standings, teamStandings, rate, sendReaction } from '../game.js';
import { lbList, podium, shareResult, reactBar, floatEmoji, clearFloat } from '../ui-game.js';
import { ATTRS, STEP, chipsOf, withChips, saveBet, scoreBet } from '../blind.js';
import { betForm, patchBet, sealedList, revealList, cleanDraft, spentOf, fmtDelta } from '../ui-blind.js';
import { BADGES } from '../api.js';
import { icon } from '../icons.js';
import { CONFIG } from '../config.js';

const blank = () => ({ picks: {}, chips: {}, stars: 0 });

export default function view({ el, params }) {
  const sid = params.sid;
  if (!auth.current) { go('/play'); return; }
  const uid = auth.current.uid;
  let s = null, me = null, players = [], teams = [], bet = null, draft = blank(), draftIdx = -2, loaded = false, dirty = false;
  let res = null, stars = 0, rated = false, cataInfo = null, lastReact = 0, lastSig = '', lastIdx = -2, lastStatus = '', unBet = () => {}, unRes = () => {}, saveT = null, saving = false;

  const bank = () => chipsOf(me, s);
  const myTeam = () => teams.find((x) => x.id === me?.teamId);
  const ranked = () => standings(withChips(players, s));
  const rankOf = () => ranked().findIndex((p) => p.id === uid) + 1;
  const header = () => html`<div class="head"><div class="row wrap"><span class="pill gold">🍷 ${me?.nick || ''}</span>${myTeam() ? html`<span class="pill" style="border-color:${myTeam().color}">${myTeam().name}</span>` : ''}</div>
    <div class="row"><span class="pill" data-bank>🪙 ${me ? bank() : ''}</span><button class="icon-btn" data-act="mute" aria-label="sound">${isMuted() ? '🔇' : '🔊'}</button></div></div>`;

  function sig() {
    const base = [s?.status, s?.qIndex, s?.cur?.open, s?.reveal?.index, me?.score, me?.lastOk, me?.teamId, bet?.done, bet?.res?.delta, s?.teamMode, rated, stars, res?.rank, loaded];
    if (!s || s.status === 'lobby') base.push(players.length, teams.map((x) => x.id + x.name).join());
    if (s?.status === 'reveal' || s?.status === 'ended') base.push(players.map((p) => p.id + ':' + p.score).join(), teams.length);
    return JSON.stringify(base);
  }

  function render(force = false) {
    if (!s) { setHtml(el, html`<div class="game">${skeleton('rows')}</div>`); return; }
    const bk = el.querySelector('[data-bank]'); if (bk && me) bk.textContent = '🪙 ' + bank();
    const sg = sig(); if (!force && sg === lastSig) return; lastSig = sg;
    let body;
    if (s.status === 'lobby') body = lobby();
    else if (s.status === 'question') body = question();
    else if (s.status === 'reveal') body = reveal();
    else body = ended();
    setHtml(el, html`<div class="game blind">${header()}${body}${s.status !== 'question' ? reactBar() : ''}</div>`);
    if (s.status === 'question' && !bet?.done) patchBet(el, draft, bank(), s.minBet ?? 0);
    if (s.status === 'ended' && lastStatus !== 'ended') { if (res?.rank <= 3 || rankOf() <= 3) celebrate(); else sfx.good(); }
    if (s.status === 'reveal' && lastStatus !== 'reveal' && (bet?.res?.delta ?? me?.lastPts) > 0) { confetti(34); }
    lastStatus = s.status;
  }

  const lobby = () => html`<div class="card center" style="margin:auto 0"><div style="font-size:3rem" class="boot-glass">🍷</div><h2>${t('game.lobbyTitle', { nick: me?.nick || '' })}</h2>
      <p class="muted">${t('blind.lobbyText', { n: s.startChips ?? 100 })}</p>
      <div class="pill">${s.title}</div><div class="mt"><span class="pill gold">👥 ${t('game.players', { n: players.length })}</span> <span class="pill">🍷 ${t('blind.nWines', { n: s.nWines })}</span></div>
      ${s.teamMode === 'free' && teams.length ? html`<label class="field mt"><span>${t('join.team')}</span><select data-act="team"><option value="">${t('join.noTeam')}</option>${teams.map((x) => html`<option value="${x.id}" ${x.id === me?.teamId ? 'selected' : ''}>${x.name}</option>`)}</select></label>` : ''}
      ${s.teamMode === 'assigned' ? html`<p class="hint">${myTeam() ? t('game.yourTeam', { name: myTeam().name }) : t('join.assigned')}</p>` : ''}</div>`;

  const question = () => {
    const c = s.cur; if (!c) return '';
    const head = html`<div class="row between mb"><span class="pill gold">${t('blind.wine', { i: c.index + 1, n: s.nWines })}</span></div><h2 style="margin-top:0">${c.label}</h2>`;
    if (!loaded) return html`${head}${skeleton('rows')}`;
    if (bet?.done) return html`${head}<div class="card center"><div style="font-size:2rem">🔒</div><b>${t('blind.sealed')}</b><p class="muted small" style="margin:.3rem 0 0">${t('blind.waiting')}</p></div>
      <div class="mt">${sealedList(bet)}</div><button class="btn block mt" data-act="change">✏️ ${t('blind.change')}</button>`;
    return html`${head}${betForm(draft, bank(), s.minBet ?? 0)}`;
  };

  const reveal = () => {
    const r = s.reveal || {}, q = bet || null;
    // el banco de antes de este vino = el de ahora menos lo que ha movido
    const delta = bet?.res?.delta ?? me?.lastPts ?? 0, before = bank() - delta;
    const sc = scoreBet(q, r.sol, before, s.minBet ?? 0);
    const pos = rankOf(), rank = ranked(), ts = teamStandings(withChips(players, s), teams);
    const cls = !q ? 'miss' : delta > 0 ? 'good' : delta < 0 ? 'miss' : '';
    return html`<div class="result ${cls}"><div style="font-size:2.4rem">${!q ? '⏱️' : delta > 0 ? '🎉' : delta < 0 ? '😅' : '🤝'}</div>
        <h2>${!q ? t('blind.noPick') : delta > 0 ? t('blind.win', { n: delta }) : delta < 0 ? t('blind.lose', { n: -delta }) : t('blind.even')}</h2>
        <div class="pts"><b>${fmtDelta(delta)}</b> 🪙</div><p class="small muted" style="margin:0">${t('blind.hits', { n: sc.hits, t: ATTRS.length })}</p></div>
      <h3 class="mt">${r.label || s.cur?.label}</h3>
      ${revealList({ sol: r.sol, bet: q, r: sc, hits: r.hits, nBets: r.nBets })}
      ${r.avgStars ? html`<p class="small muted center mt">${t('blind.avgStars', { n: r.avgStars })}</p>` : ''}
      <h3 class="mt2">${t('game.ranking')} · <span class="gold">#${pos}</span></h3>${lbList(rank, uid, { limit: 5 })}
      ${pos > 5 ? html`<ol class="lb"><li class="me"><span class="pos">${pos}</span><span class="nm">${me?.nick}</span><span class="sc">${bank()}</span></li></ol>` : ''}
      ${ts.length > 1 ? html`<h3 class="mt">${t('game.teams')}</h3>${lbList(ts.map((x) => ({ ...x, nick: x.name })), me?.teamId || '', { limit: 4, colorOf: (x) => x.color })}` : ''}
      <p class="center muted mt">${t('blind.nextSoon')}</p>`;
  };

  const ended = () => {
    const rank = ranked(), pos = rankOf(), ts = teamStandings(withChips(players, s), teams).filter((x) => x.members > 0);
    const nb = (res?.newBadges || []).map((b) => BADGES.find((x) => x.id === b)).filter(Boolean);
    return html`<div class="center"><h1>${t('game.finished')}</h1></div>
      ${podium(rank, t('blind.chips'))}
      <div class="card center gold-edge"><div class="muted">${t('game.yourPos')}</div><div class="bignum">#${pos}<span class="muted small"> / ${rank.length}</span></div>
        <div class="row wrap mt" style="justify-content:center"><span class="pill gold">🪙 ${bank()}</span><span class="pill ok">✓ ${me?.correct || 0}/${s.total || 0}</span></div>
        ${res?.stamped ? html`<div class="stamp-won"><span class="stamp on">${icon('glass', 24, 1.5)}</span><div><b>${t('stamps.won', { n: ((res.stamps - 1) % CONFIG.stamps.goal) + 1, goal: CONFIG.stamps.goal })}</b>${res.stamps % CONFIG.stamps.goal === 0 ? html`<div class="small muted">${t('stamps.wonCard')}</div>` : ''}</div></div>` : ''}
        ${res ? html`<p class="small muted mt" style="margin-bottom:0">${t('game.addedRank', { n: res.pointsGained })}</p>` : loggedIn() ? html`<p class="small muted mt" style="margin-bottom:0">…</p>` : html`<p class="small muted mt" style="margin-bottom:0">${t('join.guest')} <a href="#/login">${t('auth.login')}</a></p>`}</div>
      ${nb.length ? html`<div class="card mt center"><h3>${t('game.newBadges')}</h3><div class="row wrap" style="justify-content:center">${nb.map((b) => html`<div class="center"><div class="badge-ic">${b.icon}</div><div class="small">${t('badge.' + b.id)}</div></div>`)}</div></div>` : ''}
      ${ts.length > 1 ? html`<h3 class="mt2">${t('game.teams')}</h3>${lbList(ts.map((x) => ({ ...x, nick: x.name })), me?.teamId || '', { colorOf: (x) => x.color })}` : ''}
      <button class="btn gold block mt" data-act="share">📤 ${t('game.share')}</button>
      ${rated ? html`<p class="center muted mt">❤️ ${t('game.thanks')}</p>` : html`<form class="card mt" id="rateForm"><h3>${t('game.rate')}</h3><div class="stars">${[1, 2, 3, 4, 5].map((n) => html`<button type="button" data-star="${n}" class="${n <= stars ? 'on' : ''}">⭐</button>`)}</div>
        <label class="field mt"><span>${t('game.comment')}</span><input name="comment" maxlength="200"></label><button class="btn block" ${stars ? '' : 'disabled'}>${t('game.sendRating')}</button></form>`}
      <a class="btn ghost block mt" href="#/">${t('common.home')}</a>`;
  };

  // ---------- guardar la apuesta ----------
  // se guarda sola unos instantes después de cada cambio, y de golpe al pulsar «Apostar»: si el presentador revela antes, no se pierde lo elegido
  const payload = (done) => ({ ...cleanDraft(draft, bank()), done });
  async function flush(done = false) {
    clearTimeout(saveT); saveT = null;
    if (!s?.cur?.open || draftIdx !== s.cur.index) return;
    try { await saveBet(sid, uid, draftIdx, payload(done)); dirty = false; } catch (ex) { console.error(ex); throw ex; }
  }
  const queueSave = () => { dirty = true; clearTimeout(saveT); saveT = setTimeout(() => flush().catch(() => {}), 600); };
  const touched = () => { patchBet(el, draft, bank(), s.minBet ?? 0); queueSave(); };

  function onSession(d) {
    const prev = s; s = d;
    if (!s) { setHtml(el, html`<div class="game"><div class="card center empty"><span class="big">🤷</span>${t('game.gone')}<div class="mt"><a class="btn" href="#/">${t('common.home')}</a></div></div></div>`); return; }
    const idx = s.status === 'question' ? s.cur?.index : -1;
    if (s.status === 'question' && idx !== lastIdx) {
      lastIdx = idx; draftIdx = idx; draft = blank(); bet = null; loaded = false; dirty = false; sfx.start();
      unBet(); unBet = db.onDoc(`sessions/${sid}/bets/${idx}_${uid}`, (b) => {
        bet = b;
        // al volver a entrar (o recargar) se recupera lo que ya se había elegido
        if (!loaded) { loaded = true; if (b && !dirty) draft = { picks: { ...(b.picks || {}) }, chips: { ...(b.chips || {}) }, stars: b.stars || 0 }; }
        render();   // sin forzar: cada autoguardado vuelve por aquí y rehacer el formulario cerraría el desplegable que se está tocando
      });
    }
    if (s.status === 'reveal' && prev?.status !== 'reveal') setTimeout(() => ((bet?.res?.delta ?? me?.lastPts ?? 0) > 0 ? sfx.good() : sfx.bad()), 150);
    if (s.status === 'ended' && s.cataId && !cataInfo) db.get('catas/' + s.cataId).then((c) => { cataInfo = c; }).catch(() => {});
    if (s.status === 'ended' && !unRes.set && loggedIn()) { unRes.set = 1; unRes = Object.assign(db.onDoc(`results/${uid}_${sid}`, (r) => { res = r; render(true); }), { set: 1 }); }
    render();
  }

  const subs = [
    db.onDoc(`sessions/${sid}`, onSession),
    db.onDoc(`sessions/${sid}/players/${uid}`, (p) => { if (!p && s) { go('/join/' + s.code); return; } me = p; render(); }),
    db.onList(`sessions/${sid}/players`, {}, (l) => { players = l; render(); }),
    db.onList(`sessions/${sid}/teams`, {}, (l) => { teams = l; render(); }),
  ];
  const onHide = () => { if (document.hidden && dirty) flush().catch(() => {}); };
  document.addEventListener('visibilitychange', onHide);
  const offs = [
    on(el, 'change', '[data-pick]', (e, sel) => {
      const id = sel.dataset.pick; sfx.unlock();
      if (sel.value) { draft.picks[id] = sel.value; if (!draft.chips[id]) draft.chips[id] = Math.min(STEP * 2, Math.max(0, bank() - spentOf(draft.chips, draft.picks))); }
      else { delete draft.picks[id]; draft.chips[id] = 0; }
      touched();
    }),
    on(el, 'click', '[data-chip]', (e, b) => {
      const id = b.dataset.chip; if (!draft.picks[id]) return;
      const left = bank() - spentOf(draft.chips, draft.picks), d = Number(b.dataset.d) * STEP;
      const next = Math.max(0, (draft.chips[id] || 0) + d);
      if (d > 0 && left < d) return;
      draft.chips[id] = next; sfx.tick?.(); touched();
    }),
    on(el, 'click', '[data-bstar]', (e, b) => { draft.stars = Number(b.dataset.bstar); touched(); }),
    on(el, 'click', '[data-act="bet"]', async (e, b) => {
      if (!s?.cur?.open) return; sfx.unlock(); b.disabled = true;
      try { await flush(true); sfx.good(); } catch { toast(t('err.generic'), 'err'); b.disabled = false; }
    }),
    on(el, 'click', '[data-act="change"]', async () => {
      if (!s?.cur?.open) return;
      draft = { picks: { ...(bet?.picks || {}) }, chips: { ...(bet?.chips || {}) }, stars: bet?.stars || 0 };
      try { await flush(false); } catch { toast(t('err.generic'), 'err'); }
    }),
    on(el, 'click', '[data-act="mute"]', () => { setMuted(!isMuted()); sfx.unlock(); render(true); }),
    on(el, 'click', '[data-react]', (e, b) => {
      const now = Date.now(); if (now - lastReact < 1200 || !me) return; lastReact = now;
      const emoji = b.dataset.react; floatEmoji(emoji); b.classList.add('sent'); setTimeout(() => b.classList.remove('sent'), 450);
      sendReaction(sid, uid, emoji).catch((ex) => console.error(ex));
    }),
    on(el, 'change', '[data-act="team"]', async (e, sel) => { await db.update(`sessions/${sid}/players/${uid}`, { teamId: sel.value }); }),
    on(el, 'click', '[data-star]', (e, b) => { stars = Number(b.dataset.star); render(true); }),
    on(el, 'submit', '#rateForm', async (e) => { e.preventDefault(); const f = formData(e.target); try { await rate(sid, uid, stars, f.comment); rated = true; render(true); } catch { toast(t('err.generic'), 'err'); } }),
    on(el, 'click', '[data-act="share"]', () => { const pos = rankOf(); shareResult({ title: s.title, nick: me?.nick || '', rank: pos, players: players.length, score: bank(), correct: me?.correct || 0, total: s.total || 0, wines: cataInfo?.wines || '', date: cataInfo?.startsAt || 0 }); }),
  ];
  render();
  return () => { clearTimeout(saveT); document.removeEventListener('visibilitychange', onHide); clearFloat(); subs.forEach((f) => f()); offs.forEach((f) => f()); unBet(); typeof unRes === 'function' && unRes(); };
}
