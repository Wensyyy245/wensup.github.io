/* ============================================================
   WensUP — клиент
   ============================================================ */
(() => {
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = n => Math.round(n).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');

const S = {
  user: null, inv: [], gifts: {}, cases: [], tasks: [], feed: [],
  mines: null, withdrawals: [], cfg: {}, tab: 'cases',
};

/* ---------------- Telegram ---------------- */
function haptic(kind = 'light') {
  try {
    const h = tg && tg.HapticFeedback;
    if (!h) return;
    if (kind === 'ok' || kind === 'err' || kind === 'warn') h.notificationOccurred({ok:'success', err:'error', warn:'warning'}[kind]);
    else if (kind === 'sel') h.selectionChanged();
    else h.impactOccurred(kind);
  } catch (e) {}
}
if (tg) {
  try { tg.ready(); tg.expand(); } catch (e) {}
  try { tg.setHeaderColor('#07060f'); tg.setBackgroundColor('#07060f'); } catch (e) {}
  try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (e) {}
}

function getInitData() {
  if (tg && tg.initData) return tg.initData;
  const dev = new URLSearchParams(location.search).get('dev');
  return dev ? 'dev:' + dev : '';
}

async function api(path, body = {}) {
  let r;
  try {
    r = await fetch(path, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({...body, initData: getInitData()}),
    });
  } catch (e) {
    throw new Error('Нет соединения с сервером');
  }
  let j;
  try { j = await r.json(); } catch (e) { throw new Error('Ошибка сервера'); }
  if (!j.ok) throw new Error(j.error || 'Ошибка');
  return j;
}

/* ---------------- предметы ---------------- */
function tierOf(v) { return v < 20 ? 1 : v < 50 ? 2 : v < 100 ? 3 : v < 250 ? 4 : v < 1000 ? 5 : 6; }

function itemOf(r) {
  if (r.type === 'stars') {
    const a = r.amount ?? r.value;
    return {emoji: '⭐', name: `${a} ★`, value: a, nft: false, tier: tierOf(a), stars: true};
  }
  const g = S.gifts[r.key];
  return {emoji: g.emoji, name: g.name, value: g.value, nft: g.nft, tier: tierOf(g.value), key: g.key};
}

function tile(it, o = {}) {
  const cls = ['tile', 't-c' + it.tier, it.nft ? 'is-nft' : '', it.tier >= 5 ? 'rare' : '', o.cls || ''].join(' ');
  return `<div class="${cls}" ${o.attrs || ''}>
    ${o.chance != null ? `<span class="tile-chance">${o.chance}%</span>` : ''}
    ${it.nft ? '<span class="nft-badge">NFT</span>' : ''}
    <div class="tile-emoji">${it.emoji}</div>
    <div class="tile-name">${esc(it.name)}</div>
    <div class="tile-val">${fmt(it.value)} ★</div>
  </div>`;
}

const invItem = row => itemOf({type: 'gift', key: row.key});

/* ---------------- toasts / модалки ---------------- */
function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
  if (kind === 'err') haptic('err'); else if (kind === 'good') haptic('ok');
}

function openModal(html, {wide = false, locked = false} = {}) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}"><button class="sheet-x" aria-label="Закрыть">✕</button><div class="sheet-body"></div></div>`;
  const o = {
    el: m, locked, body: $('.sheet-body', m), closed: false,
    set(h) { this.body.innerHTML = h; },
    close() {
      if (this.closed) return;
      this.closed = true;
      m.classList.add('closing');
      setTimeout(() => m.remove(), 250);
      if (this.onClose) this.onClose();
    },
  };
  o.set(html);
  $('.sheet-x', m).onclick = () => { if (!o.locked) o.close(); };
  m.addEventListener('pointerdown', e => { if (e.target === m && !o.locked) o.close(); });
  $('#modal-root').appendChild(m);
  return o;
}

/* ---------------- баланс ---------------- */
let balShown = 0, balAnim = 0;
function setBalance(n, animate = true) {
  S.user.balance = n;
  const el = $('#balVal');
  cancelAnimationFrame(balAnim);
  const from = balShown, to = n;
  if (!animate || from === to) { balShown = to; el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 700;
  const step = t => {
    const k = clamp((t - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
    balShown = Math.round(from + (to - from) * e);
    el.textContent = fmt(balShown);
    if (k < 1) balAnim = requestAnimationFrame(step);
  };
  balAnim = requestAnimationFrame(step);
  const chip = $('#balChip');
  chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump');
}

/* ============================================================
   FX: фон, конфетти
   ============================================================ */
const bg = (() => {
  const c = $('#bg'), x = c.getContext('2d');
  let w, h, ps = [];
  function size() {
    const d = Math.min(devicePixelRatio || 1, 2);
    w = c.width = innerWidth * d; h = c.height = innerHeight * d;
    const n = innerWidth < 700 ? 38 : 80;
    ps = Array.from({length: n}, () => mk(true));
  }
  function mk(init) {
    return {x: Math.random() * w, y: init ? Math.random() * h : h + 20, r: rnd(.6, 2.4) * (w > 1200 ? 1.5 : 1),
      vy: rnd(.15, .6), vx: rnd(-.15, .15), a: rnd(.25, .8), ph: rnd(0, 6.28),
      hue: [265, 300, 190, 45][Math.floor(Math.random() * 4)]};
  }
  function tick() {
    x.clearRect(0, 0, w, h);
    for (const p of ps) {
      p.y -= p.vy; p.x += p.vx + Math.sin(p.ph += .01) * .2;
      if (p.y < -20) Object.assign(p, mk(false));
      x.beginPath();
      x.fillStyle = `hsla(${p.hue},100%,75%,${p.a * (.6 + Math.sin(p.ph * 3) * .4)})`;
      x.shadowColor = `hsl(${p.hue},100%,70%)`; x.shadowBlur = 12;
      x.arc(p.x, p.y, p.r * (devicePixelRatio > 1 ? 1.5 : 1), 0, 6.283); x.fill();
    }
    requestAnimationFrame(tick);
  }
  size(); addEventListener('resize', size); tick();
})();

const fx = (() => {
  const c = $('#fx'), x = c.getContext('2d');
  let ps = [], run = false, d = 1;
  function size() { d = Math.min(devicePixelRatio || 1, 2); c.width = innerWidth * d; c.height = innerHeight * d; }
  size(); addEventListener('resize', size);
  const COLORS = {
    1: ['#9aa4b8', '#ffffff'], 2: ['#4cc3ff', '#ffffff', '#8be0ff'], 3: ['#8b6bff', '#d3c5ff', '#ffffff'],
    4: ['#ff5ccf', '#ffb3ec', '#8b5cff'], 5: ['#ffd24a', '#ffb340', '#fff3b0', '#ff8a3d'],
    6: ['#ff4d5e', '#ffd24a', '#ff5ccf', '#38e1ff', '#3dffa2', '#fff'],
  };
  function loop() {
    x.clearRect(0, 0, c.width, c.height);
    ps = ps.filter(p => p.life > 0 && p.y < innerHeight + 40);
    for (const p of ps) {
      p.vy += p.g; p.vx *= p.drag; p.vy *= p.drag;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 1;
      x.save();
      x.translate(p.x * d, p.y * d); x.rotate(p.rot);
      x.globalAlpha = clamp(p.life / 30, 0, 1);
      x.fillStyle = p.col; x.shadowColor = p.col; x.shadowBlur = 8;
      if (p.star) { x.font = `${p.s * 2.4 * d}px serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('★', 0, 0); }
      else x.fillRect(-p.s * d, -p.s * .5 * d, p.s * 2 * d, p.s * d);
      x.restore();
    }
    if (ps.length) requestAnimationFrame(loop); else { run = false; x.clearRect(0, 0, c.width, c.height); }
  }
  function start() { if (!run) { run = true; requestAnimationFrame(loop); } }
  return {
    burst(px, py, tier = 3, n = 50) {
      const cols = COLORS[tier] || COLORS[3];
      n = Math.round(n * (innerWidth < 700 ? .65 : 1));
      for (let i = 0; i < n; i++) {
        const a = rnd(0, 6.283), v = rnd(3, 11) * (.6 + tier * .12);
        ps.push({x: px, y: py, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, g: .22, drag: .985,
          s: rnd(3, 7), rot: rnd(0, 6), vr: rnd(-.3, .3), col: cols[i % cols.length], life: rnd(55, 100), star: Math.random() < .25});
      }
      start();
    },
    rain(tier = 5, n = 90) {
      const cols = COLORS[tier] || COLORS[5];
      n = Math.round(n * (innerWidth < 700 ? .6 : 1));
      for (let i = 0; i < n; i++) {
        ps.push({x: rnd(0, innerWidth), y: rnd(-innerHeight * .4, -10), vx: rnd(-1.5, 1.5), vy: rnd(2, 6), g: .05, drag: .995,
          s: rnd(3, 7), rot: rnd(0, 6), vr: rnd(-.2, .2), col: cols[i % cols.length], life: rnd(110, 200), star: Math.random() < .3});
      }
      start();
    },
    flash() { const f = $('#flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); },
    winBig(tier) { this.flash(); this.rain(tier); this.burst(innerWidth / 2, innerHeight / 2.5, tier, 90); haptic('ok'); },
  };
})();

/* ============================================================
   Навигация
   ============================================================ */
const TABS = [
  {id: 'cases', ic: '🎁', t: 'Кейсы'},
  {id: 'upgrade', ic: '⚡', t: 'Апгрейд'},
  {id: 'mines', ic: '💣', t: 'Сапёр'},
  {id: 'tasks', ic: '✅', t: 'Задания'},
  {id: 'profile', ic: '👤', t: 'Профиль'},
];
let cleanup = null;
let balancePoll = null;

function renderNav() {
  const dot = S.tasks.some(t => !t.done && t.enabled);
  const mk = top => TABS.map(t => `<button data-tab="${t.id}" class="${S.tab === t.id ? 'active' : ''}">
      <span class="ni">${t.ic}</span><span>${t.t}</span>${t.id === 'tasks' && dot ? '<i class="nav-dot"></i>' : ''}</button>`).join('');
  $('#topnav').innerHTML = mk(); $('#bottomnav').innerHTML = mk();
  $$('[data-tab]').forEach(b => b.onclick = () => { if (S.tab !== b.dataset.tab) { haptic('light'); go(b.dataset.tab); } });
}

function go(tab) {
  if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
  S.tab = tab;
  renderNav();
  const v = $('#view');
  v.innerHTML = '<div class="page"></div>';
  const root = $('.page', v);
  const fn = {cases: viewCases, upgrade: viewUpgrade, mines: viewMines, tasks: viewTasks, profile: viewProfile}[tab];
  cleanup = fn(root) || null;
  scrollTo({top: 0, behavior: 'instant'});
}

/* ============================================================
   КЕЙСЫ
   ============================================================ */
function feedHTML() {
  if (!S.feed.length) return '';
  const items = S.feed.map(f => {
    const it = itemOf(f.type === 'stars' ? {type: 'stars', amount: f.value} : {type: 'gift', key: f.key});
    return `<div class="feed-item t-c${it.tier}"><span class="fe">${it.emoji}</span>
      <div><div class="fu">${esc(f.name)}</div><div class="fs">${esc(f.source)}</div></div><span class="fv">${fmt(f.value)} ★</span></div>`;
  }).join('');
  const dur = Math.max(25, S.feed.length * 4);
  return `<div class="feed"><div class="feed-track" style="--dur:${dur}s">${items}${items}</div></div>`;
}

function viewCases(root) {
  const order = [...S.cases].sort((a, b) => (b.ultra ? 1 : 0) - (a.ultra ? 1 : 0) || a.price - b.price);
  root.innerHTML = `
    <section class="hero">
      <h1>Открывай кейсы,<br><span>забирай подарки</span></h1>
      <p>Мишки, розы, кольца и редкие NFT. Каждый подарок можно продать или апгрейднуть.</p>
      <div class="hero-stars">🎰</div>
    </section>
    <div id="feedBox">${feedHTML()}</div>
    <div class="section-title">🎁 Кейсы <small>${order.length} доступно</small></div>
    <div class="cases">${order.map(caseCard).join('')}</div>`;
  $$('.case', root).forEach(el => {
    el.onclick = () => { haptic('light'); openCaseModal(S.cases.find(c => c.id === el.dataset.id)); };
    el.onpointermove = e => {
      if (e.pointerType !== 'mouse' || el.classList.contains('ultra')) return;
      const r = el.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      el.style.setProperty('--ry', ((px - .5) * 14) + 'deg'); el.style.setProperty('--rx', ((.5 - py) * 14) + 'deg');
      el.style.setProperty('--mx', px * 100 + '%'); el.style.setProperty('--my', py * 100 + '%');
    };
    el.onpointerleave = () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); };
  });
}

function caseCard(c) {
  const top = [...c.loot].map(l => itemOf(l)).sort((a, b) => b.value - a.value).slice(0, 4).map(i => i.emoji).join('');
  if (c.ultra) {
    const sp = Array.from({length: 14}, () => `<i style="left:${rnd(0, 100)}%;top:${rnd(0, 100)}%;animation-delay:${rnd(0, 3)}s"></i>`).join('');
    return `<div class="case ultra" data-id="${c.id}" style="--cc:${c.color}">
      <div class="sparkles">${sp}</div>
      <div class="case-emoji">${c.emoji}</div>
      <div class="case-info"><span class="ultra-tag">ULTRA • NFT</span>
        <div class="case-name">${esc(c.name)}</div>
        <div class="case-desc">${esc(c.desc)}</div>
        <div class="case-preview">${top}</div>
        <span class="case-price"><i>★</i>${fmt(c.price)}</span></div></div>`;
  }
  return `<div class="case" data-id="${c.id}" style="--cc:${c.color}">
    <div class="case-emoji">${c.emoji}</div>
    <div class="case-name">${esc(c.name)}</div>
    <div class="case-desc">${esc(c.desc)}</div>
    <div class="case-preview">${top}</div>
    <span class="case-price"><i>★</i>${fmt(c.price)}</span></div>`;
}

function openCaseModal(c, count = 1) {
  const m = openModal('');
  const draw = () => {
    const loot = c.loot.map(l => ({it: itemOf(l), ch: l.chance})).sort((a, b) => b.it.value - a.it.value);
    const cost = c.price * count;
    m.set(`<div style="--cc:${c.color}">
      <div class="cs-head"><div class="cs-emoji">${c.emoji}</div>
        <div><h2>${esc(c.name)}</h2><div class="sub" style="margin:0">${esc(c.desc)}</div></div></div>
      <div class="cs-count">${Array.from({length: S.cfg.max_case_count}, (_, i) =>
        `<button class="chip ${count === i + 1 ? 'active' : ''}" data-n="${i + 1}">×${i + 1}</button>`).join('')}</div>
      <button class="btn block ${c.ultra ? 'gold' : ''}" id="openBtn">Открыть за ${fmt(cost)} ★</button>
      <div class="section-title" style="font-size:15px;margin:20px 0 0">Содержимое</div>
      <div class="loot">${loot.map(l => tile(l.it, {chance: l.ch, cls: 'pop'})).join('')}</div></div>`);
    $$('[data-n]', m.el).forEach(b => b.onclick = () => { count = +b.dataset.n; haptic('sel'); draw(); });
    $('#openBtn', m.el).onclick = async () => {
      if (S.user.balance < cost) { toast('Недостаточно звёзд', 'err'); m.close(); setTimeout(openDeposit, 300); return; }
      const btn = $('#openBtn', m.el); btn.disabled = true;
      try {
        const res = await api('/api/case/open', {case: c.id, count});
        m.locked = true;
        await playSpin(m, c, res, count);
      } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
    };
  };
  draw();
}

function randomLoot(c) {
  let r = Math.random() * 100;
  for (const l of c.loot) { r -= l.chance; if (r <= 0) return l; }
  return c.loot[0];
}

async function playSpin(m, c, res, count) {
  const rows = res.results;
  m.set(`<div class="spin-box" style="--ih:${rows.length > 2 ? 82 : 104}px">
    <h3 class="spin-title">Удача крутится…</h3>
    <div class="spin-rows">${rows.map(() => `<div class="rl-view"><div class="rl-strip"></div><div class="rl-marker"></div></div>`).join('')}</div></div>`);
  const box = $('.spin-box', m.el);
  const views = $$('.rl-view', m.el);
  const vw = views[0].clientWidth;
  const iw = clamp(Math.round(vw / 3.8), 84, 120), step = iw + 8, WIN = 42, N = 52;
  box.style.setProperty('--iw', iw + 'px');
  const anims = rows.map((r, i) => {
    const strip = $('.rl-strip', views[i]);
    let html = '';
    for (let k = 0; k < N; k++) {
      const it = k === WIN ? itemOf(r) : itemOf(randomLoot(c));
      html += `<div class="rl-item t-c${it.tier}"><div class="tile-emoji">${it.emoji}</div><div class="tile-val">${it.stars ? it.name : fmt(it.value) + ' ★'}</div></div>`;
    }
    strip.innerHTML = html;
    const off = WIN * step + step / 2 + 4 + rnd(-.38, .38) * iw;
    const x = views[i].clientWidth / 2 - off;
    return {strip, x, a: strip.animate([{transform: 'translateX(0)'}, {transform: `translateX(${x}px)`}],
      {duration: 5200 + i * 450, easing: 'cubic-bezier(.08,.72,.12,1)', fill: 'forwards'})};
  });
  // тактильные «тики» по первой ленте
  let lastIdx = -1, ticking = true;
  const tick = () => {
    if (!ticking) return;
    const mat = new DOMMatrix(getComputedStyle(anims[0].strip).transform);
    const idx = Math.floor((views[0].clientWidth / 2 - mat.m41) / step);
    if (idx !== lastIdx) { lastIdx = idx; haptic('sel'); }
    requestAnimationFrame(tick);
  };
  tick();
  await Promise.all(anims.map(a => a.a.finished));
  ticking = false;
  views.forEach(v => v.style.boxShadow = '0 0 30px rgba(255,210,74,.35)');
  await sleep(550);

  setBalance(res.balance);
  S.feed = res.feed; 
  const gifts = rows.filter(r => r.type === 'gift');
  gifts.forEach(g => S.inv.unshift({id: g.inv_id, key: g.key}));
  const total = rows.reduce((s, r) => s + r.value, 0);
  const best = Math.max(...rows.map(r => itemOf(r).tier));
  if (best >= 5 || total >= c.price * 2) fx.winBig(best); else fx.burst(innerWidth / 2, innerHeight / 2, best, 50);
  showSpinResult(m, c, rows, count, total);
}

function showSpinResult(m, c, rows, count, total) {
  const gifts = rows.filter(r => r.type === 'gift');
  const giftSum = gifts.reduce((s, r) => s + r.value, 0);
  m.set(`<div class="res-title">${total >= c.price * count ? '🎉 Отличный дроп!' : 'Ваш дроп'}</div>
    <div class="res-total">Общая стоимость: <b>${fmt(total)} ★</b></div>
    <div class="res-grid">${rows.map((r, i) => tile(itemOf(r), {cls: 'pop', attrs: `style="animation-delay:${i * .1}s"`})).join('')}</div>
    <div class="res-actions">
      ${gifts.length ? `<button class="btn green" id="sellBtn">Продать за ${fmt(giftSum)} ★</button>` : ''}
      <button class="btn" id="againBtn">Ещё раз</button>
      <button class="btn ghost" id="closeBtn">В инвентарь</button></div>`);
  m.locked = false;
  const sb = $('#sellBtn', m.el);
  if (sb) sb.onclick = async () => {
    sb.disabled = true;
    try {
      const r = await api('/api/inventory/sell', {ids: gifts.map(g => g.inv_id)});
      S.inv = r.inventory; setBalance(r.balance);
      toast(`Продано за ${fmt(r.total)} ★`, 'good'); fx.burst(innerWidth / 2, innerHeight / 2, 5, 40);
      m.close();
    } catch (e) { toast(e.message, 'err'); sb.disabled = false; }
  };
  $('#againBtn', m.el).onclick = () => { m.close(); setTimeout(() => openCaseModal(c, count), 280); };
  $('#closeBtn', m.el).onclick = () => m.close();
}

/* ============================================================
   АПГРЕЙД
   ============================================================ */
const UP = {sel: new Set(), target: null, stars: 0, busy: false};

function upChance(inp, stars, tv) {
  if (!tv) return 0;
  return clamp((inp + stars) / tv * 100 * S.cfg.upgrade_edge, 0.5, S.cfg.upgrade_max);
}

function viewUpgrade(root) {
  UP.sel = new Set([...UP.sel].filter(id => S.inv.some(i => i.id === id)));
  root.innerHTML = `
    <div class="section-title">⚡ Апгрейд <small>обменяй подарки на более дорогой</small></div>
    <div class="panel up-stage" id="stage"></div>
    <div class="panel up-controls" id="ctl"></div>
    <div class="up-cols">
      <div class="panel"><h3>Твои подарки <span id="invHint"></span></h3><div class="up-list" id="invList"></div></div>
      <div class="panel"><h3>Цель апгрейда</h3><div class="up-list" id="tgtList"></div></div>
    </div>`;

  const selVal = () => [...UP.sel].reduce((s, id) => s + invItem(S.inv.find(i => i.id === id)).value, 0);
  const tv = () => UP.target ? S.gifts[UP.target].value : 0;
  const maxStars = () => {
    if (!UP.target) return 0;
    const need = Math.ceil(S.cfg.upgrade_max / 100 / S.cfg.upgrade_edge * tv() - selVal());
    return clamp(Math.min(need, S.user.balance), 0, 1e9);
  };

  function stage(anim) {
    const inp = selVal(), t = UP.target ? S.gifts[UP.target] : null;
    const ch = t ? upChance(inp, UP.stars, t.value) : 0;
    const first = [...UP.sel][0] != null ? invItem(S.inv.find(i => i.id === [...UP.sel][0])) : null;
    const left = UP.sel.size
      ? `<div class="slot-box filled t-c${first.tier}">${first.emoji}${UP.sel.size > 1 ? `<span class="cnt">${UP.sel.size}</span>` : ''}</div>
         <div class="slot-label">${UP.sel.size > 1 ? UP.sel.size + ' подарка' : esc(first.name)}</div>
         <div class="slot-val">${fmt(inp)}${UP.stars ? ` + ${fmt(UP.stars)}` : ''} ★</div>`
      : `<div class="slot-box">＋</div><div class="slot-label">Выбери подарки</div>`;
    const ti = t ? itemOf({type: 'gift', key: t.key}) : null;
    const right = t
      ? `<div class="slot-box filled t-c${ti.tier}" id="tSlot">${t.emoji}</div><div class="slot-label">${esc(t.name)}</div><div class="slot-val">${fmt(t.value)} ★</div>`
      : `<div class="slot-box">？</div><div class="slot-label">Выбери цель</div>`;
    if (anim === 'keep') {
      $('#ringArc').setAttribute('stroke-dasharray', `${ch} 100`);
      $('#ringPct').innerHTML = `${ch ? ch.toFixed(ch < 10 ? 2 : 1) : '0'}<small>%</small>`;
      $('#slotL').innerHTML = left; $('#slotR').innerHTML = right;
      return;
    }
    $('#stage').innerHTML = `
      <div class="up-slot" id="slotL">${left}</div>
      <div class="ring-wrap" id="ring">
        <svg viewBox="0 0 120 120"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#3dffa2"/><stop offset="1" stop-color="#38e1ff"/></linearGradient></defs>
          <circle class="ring-track" cx="60" cy="60" r="50"/>
          <circle class="ring-win" id="ringArc" cx="60" cy="60" r="50" pathLength="100" stroke-dasharray="${ch} 100"/></svg>
        <div class="ring-ptr" id="ptr"><i></i></div>
        <div class="ring-center"><div class="ring-pct" id="ringPct">${ch ? ch.toFixed(ch < 10 ? 2 : 1) : '0'}<small>%</small></div><div class="ring-sub">шанс</div></div>
      </div>
      <div class="up-slot" id="slotR">${right}</div>`;
  }

  function controls() {
    const ms = maxStars();
    const inp = selVal(), t = UP.target ? S.gifts[UP.target] : null;
    UP.stars = clamp(UP.stars, 0, ms);
    const base = t ? upChance(inp, 0, t.value) : 0;
    const ready = UP.sel.size && t && inp < t.value;
    $('#ctl').innerHTML = `
      <div class="up-stars-head"><div><div class="muted" style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Добавить звёзды</div>
        <div class="muted" style="font-size:12px">Увеличивают шанс · баланс ${fmt(S.user.balance)} ★</div></div>
        <b id="starsVal">+${fmt(UP.stars)} ★</b></div>
      <input type="range" id="starsRange" min="0" max="${ms}" step="1" value="${UP.stars}" ${ms ? '' : 'disabled'}>
      <div class="row" style="margin-top:12px">
        <div class="chips grow">
          <button class="chip" data-p="0">0</button><button class="chip" data-p="25">25%</button>
          <button class="chip" data-p="50">50%</button><button class="chip" data-p="100">Макс</button></div>
        <div class="muted" style="font-size:12px;text-align:right" id="gain">${t && UP.stars ? `+${(upChance(inp, UP.stars, t.value) - base).toFixed(1)}% к шансу` : ''}</div></div>
      <div class="up-hint">${!UP.sel.size ? 'Выбери один или несколько подарков из инвентаря.' : !t ? 'Теперь выбери подарок, на который хочешь апгрейднуть.' : 'Подарки сгорают при неудаче. Добавь звёзды ползунком, чтобы увеличить шанс.'}</div>
      <button class="btn block" id="upBtn" ${ready ? '' : 'disabled'}>⚡ Апгрейднуть</button>`;
    const range = $('#starsRange');
    const paint = () => range.style.setProperty('--v', (ms ? range.value / ms * 100 : 0) + '%');
    paint();
    range.oninput = () => {
      UP.stars = +range.value; paint(); $('#starsVal').textContent = `+${fmt(UP.stars)} ★`;
      if (t) $('#gain').textContent = UP.stars ? `+${(upChance(inp, UP.stars, t.value) - base).toFixed(1)}% к шансу` : '';
      stage('keep');
    };
    range.onchange = () => haptic('light');
    $$('[data-p]', $('#ctl')).forEach(b => b.onclick = () => {
      UP.stars = Math.round(ms * +b.dataset.p / 100); haptic('sel'); controls(); stage('keep');
    });
    $('#upBtn').onclick = doUpgrade;
  }

  function lists() {
    const inp = selVal();
    $('#invHint').textContent = UP.sel.size ? `· выбрано ${UP.sel.size}` : '';
    $('#invList').innerHTML = S.inv.length
      ? `<div class="tiles">${S.inv.map(r => { const it = invItem(r);
          return tile(it, {cls: 'click ' + (UP.sel.has(r.id) ? 'sel' : ''), attrs: `data-inv="${r.id}"`}); }).join('')}</div>`
      : `<div class="empty"><span class="big">📦</span>Инвентарь пуст.<br>Открой кейс, чтобы получить подарки!</div>`;
    $('#tgtList').innerHTML = `<div class="tiles">${Object.values(S.gifts).sort((a, b) => a.value - b.value).map(g => {
      const it = itemOf({type: 'gift', key: g.key});
      const dis = UP.sel.size && g.value <= inp;
      return tile(it, {cls: 'click ' + (UP.target === g.key ? 'sel' : '') + (dis ? ' dis' : ''), attrs: `data-tgt="${g.key}"`});
    }).join('')}</div>`;
    $$('[data-inv]', root).forEach(el => el.onclick = () => {
      if (UP.busy) return;
      const id = +el.dataset.inv;
      UP.sel.has(id) ? UP.sel.delete(id) : (UP.sel.size < 6 ? UP.sel.add(id) : toast('Максимум 6 подарков', 'err'));
      haptic('sel');
      if (UP.target && selVal() >= tv()) UP.target = null;
      UP.stars = 0; refresh();
    });
    $$('[data-tgt]', root).forEach(el => el.onclick = () => {
      if (UP.busy) return;
      const g = S.gifts[el.dataset.tgt];
      if (UP.sel.size && g.value <= selVal()) return toast('Выбери цель дороже', 'err');
      UP.target = UP.target === g.key ? null : g.key; UP.stars = 0; haptic('sel'); refresh();
    });
  }

  function refresh() { stage(); controls(); lists(); }

  async function doUpgrade() {
    if (UP.busy) return;
    UP.busy = true;
    const btn = $('#upBtn'); btn.disabled = true;
    try {
      const res = await api('/api/upgrade', {items: [...UP.sel], target: UP.target, stars: UP.stars});
      // сервер мог урезать звёзды
      $('#ringArc').setAttribute('stroke-dasharray', `${res.chance} 100`);
      $('#ringPct').innerHTML = `${res.chance}<small>%</small>`;
      const ptr = $('#ptr');
      const ang = 360 * 6 + res.roll * 3.6;
      ptr.animate([{transform: 'rotate(0deg)'}, {transform: `rotate(${ang}deg)`}],
        {duration: 5200, easing: 'cubic-bezier(.1,.65,.08,1)', fill: 'forwards'});
      let ticking = true, last = -1;
      (function t() {
        if (!ticking) return;
        const m = new DOMMatrix(getComputedStyle(ptr).transform);
        const a = Math.atan2(m.b, m.a) * 180 / Math.PI, k = Math.floor(a / 12);
        if (k !== last) { last = k; haptic('sel'); }
        requestAnimationFrame(t);
      })();
      await sleep(5300); ticking = false;
      S.inv = res.inventory; S.feed = res.feed; setBalance(res.balance);
      const ring = $('#ring'), tl = S.gifts[res.target];
      ring.classList.add(res.win ? 'win' : 'lose');
      if (res.win) {
        const r = ring.getBoundingClientRect();
        fx.winBig(itemOf({type: 'gift', key: tl.key}).tier);
        fx.burst(r.left + r.width / 2, r.top + r.height / 2, 5, 80);
        toast(`🎉 Апгрейд удался! ${tl.emoji} ${tl.name}`, 'good');
      } else { haptic('err'); toast('Не повезло… подарки сгорели 🔥', 'err'); }
      await sleep(1700);
      UP.sel.clear(); UP.stars = 0;
      if (!res.win) UP.target = null; else UP.target = null;
    } catch (e) {
      toast(e.message, 'err');
    }
    UP.busy = false;
    if (S.tab === 'upgrade') refresh();
  }

  refresh();
}

/* ============================================================
   САПЁР
   ============================================================ */
const M = {bet: 10, mines: 3, busy: false};

function viewMines(root) {
  root.innerHTML = `
    <div class="section-title">💣 Сапёр <small>открывай кристаллы, обходи мины</small></div>
    <div class="mines">
      <div class="panel"><div class="mines-top" id="mStats"></div><div class="mgrid" id="mGrid"></div></div>
      <div class="panel mines-ctl" id="mCtl"></div>
    </div>`;
  const grid = $('#mGrid');
  grid.innerHTML = Array.from({length: 25}, (_, i) => `<div class="mt" data-i="${i}"><div class="mt-in"><span></span></div></div>`).join('');
  const tiles = $$('.mt', grid);

  const st = () => S.mines;
  const MAXB = () => Math.min(S.cfg.mines_max_bet, S.user.balance);

  function paintBoard(opts = {}) {
    const s = st();
    tiles.forEach((t, i) => {
      const was = t.className;
      let cls = 'mt', ico = '';
      if (opts.end) {
        const isMine = opts.end.mines.includes(i);
        if (opts.end.opened.includes(i)) { cls += ' gem na locked'; ico = '💎'; }
        else if (isMine) { cls += ' bomb locked' + (i === opts.end.hit ? '' : ' ghost'); ico = '💣'; }
        else { cls += ' ghost locked'; }
      } else if (s) {
        if (s.opened.includes(i)) { cls += ' gem locked' + (i === opts.fresh ? '' : ' na'); ico = '💎'; }
      } else cls += ' locked';
      if (was.includes('gem') && !cls.includes(' gem') ) {}
      t.className = cls; $('span', t).textContent = ico;
    });
  }

  function stats() {
    const s = st();
    $('#mStats').innerHTML = `
      <div class="m-stat"><small>Множитель</small><b class="${s && s.opened.length ? 'up' : ''}">x${s ? s.mult.toFixed(2) : '1.00'}</b></div>
      <div class="m-stat"><small>Выигрыш</small><b class="${s && s.payout ? 'up' : ''}">${s ? fmt(s.payout) : 0} ★</b></div>
      <div class="m-stat"><small>Мин</small><b>${s ? s.mines_cnt : M.mines}</b></div>`;
  }

  function ctl() {
    const s = st();
    stats();
    if (s) {
      $('#mCtl').innerHTML = `
        <h3>Идёт игра</h3>
        <div class="stats" style="margin:0 0 12px"><div class="stat"><b>${fmt(s.bet)} ★</b><small>ставка</small></div>
          <div class="stat"><b>${s.opened.length}</b><small>открыто</small></div>
          <div class="stat"><b>${s.next_mult ? 'x' + s.next_mult.toFixed(2) : '—'}</b><small>след. ход</small></div></div>
        <button class="btn gold block" id="cashBtn" ${s.opened.length ? '' : 'disabled'}>Забрать ${fmt(s.payout)} ★</button>
        <div class="pay-note">Нажимай на клетки. Чем больше открыто — тем выше множитель. Закроешь приложение — игра сохранится.</div>`;
      $('#cashBtn').onclick = cashout;
      return;
    }
    M.bet = clamp(M.bet, S.cfg.mines_min_bet, S.cfg.mines_max_bet);
    $('#mCtl').innerHTML = `
      <h3>Новая игра</h3>
      <div class="field-label"><span>Ставка</span><b>баланс ${fmt(S.user.balance)} ★</b></div>
      <input class="input" id="betIn" type="number" inputmode="numeric" min="${S.cfg.mines_min_bet}" value="${M.bet}">
      <div class="chips" style="margin-top:8px">
        <button class="chip" data-b="min">Мин</button><button class="chip" data-b="half">½</button>
        <button class="chip" data-b="x2">×2</button><button class="chip" data-b="max">Макс</button></div>
      <div class="field-label"><span>Количество мин</span><b id="mcVal">${M.mines}</b></div>
      <input type="range" id="mcRange" min="1" max="24" value="${M.mines}">
      <div class="chips" style="margin-top:10px">${[1, 3, 5, 10, 15, 24].map(n => `<button class="chip ${M.mines === n ? 'active' : ''}" data-m="${n}">${n}</button>`).join('')}</div>
      <button class="btn block" id="playBtn">Играть</button>
      <div class="pay-note">Первый ход при 3 минах: <b>x${(0.97 / (22 / 25)).toFixed(2)}</b>. Больше мин — выше риск и множитель.</div>`;
    const inp = $('#betIn'), range = $('#mcRange');
    const paint = () => range.style.setProperty('--v', ((range.value - 1) / 23 * 100) + '%');
    paint();
    inp.oninput = () => { M.bet = Math.floor(+inp.value) || 0; };
    $$('[data-b]').forEach(b => b.onclick = () => {
      const k = b.dataset.b;
      M.bet = k === 'min' ? S.cfg.mines_min_bet : k === 'half' ? Math.floor(M.bet / 2) : k === 'x2' ? M.bet * 2 : MAXB();
      M.bet = clamp(M.bet, S.cfg.mines_min_bet, Math.max(S.cfg.mines_min_bet, MAXB()));
      inp.value = M.bet; haptic('sel');
    });
    range.oninput = () => { M.mines = +range.value; $('#mcVal').textContent = M.mines; paint(); stats(); $$('[data-m]').forEach(c => c.classList.toggle('active', +c.dataset.m === M.mines)); };
    $$('[data-m]').forEach(b => b.onclick = () => { M.mines = +b.dataset.m; range.value = M.mines; range.oninput(); haptic('sel'); });
    $('#playBtn').onclick = start;
  }

  async function start() {
    if (M.busy) return;
    if (M.bet < S.cfg.mines_min_bet) return toast(`Минимальная ставка ${S.cfg.mines_min_bet} ★`, 'err');
    if (M.bet > S.user.balance) { toast('Недостаточно звёзд', 'err'); return openDeposit(); }
    M.busy = true;
    try {
      const r = await api('/api/mines/start', {bet: M.bet, mines: M.mines});
      S.mines = r.state; setBalance(r.balance);
      tiles.forEach(t => t.classList.remove('locked'));
      paintBoard(); ctl(); haptic('light');
    } catch (e) { toast(e.message, 'err'); }
    M.busy = false;
  }

  async function openTile(i) {
    if (M.busy || !st() || st().opened.includes(i)) return;
    M.busy = true;
    const t = tiles[i];
    t.style.transform = 'scale(.9)';
    try {
      const r = await api('/api/mines/open', {idx: i});
      t.style.transform = '';
      S.feed = r.feed || S.feed;
      const s = r.state;
      if (s.active) {
        S.mines = s; paintBoard({fresh: i}); ctl(); haptic('light');
        const b = t.getBoundingClientRect(); fx.burst(b.left + b.width / 2, b.top + b.height / 2, 2, 14);
      } else if (s.lost) {
        S.mines = null; setBalance(S.user.balance);
        paintBoard({end: s});
        grid.classList.remove('shake'); void grid.offsetWidth; grid.classList.add('shake');
        const b = t.getBoundingClientRect(); fx.burst(b.left + b.width / 2, b.top + b.height / 2, 6, 60);
        haptic('err'); toast(`💥 Бум! Потеряно ${fmt(s.bet)} ★`, 'err');
        ctl();
      } else {
        S.mines = null; setBalance(r.balance); paintBoard({end: s}); ctl();
        fx.winBig(5); toast(`🏆 Поле зачищено! +${fmt(s.payout)} ★`, 'good');
      }
    } catch (e) { t.style.transform = ''; toast(e.message, 'err'); }
    M.busy = false;
  }

  async function cashout() {
    if (M.busy) return;
    M.busy = true;
    try {
      const r = await api('/api/mines/cashout');
      S.mines = null; S.feed = r.feed || S.feed; setBalance(r.balance);
      paintBoard({end: r.state}); ctl();
      fx.winBig(r.state.mult >= 3 ? 5 : 4);
      toast(`💰 Выигрыш ${fmt(r.state.payout)} ★ (x${r.state.mult.toFixed(2)})`, 'good');
    } catch (e) { toast(e.message, 'err'); }
    M.busy = false;
  }

  tiles.forEach((t, i) => t.onclick = () => openTile(i));
  paintBoard(); ctl();
}

/* ============================================================
   ЗАДАНИЯ
   ============================================================ */
function viewTasks(root) {
  const render = () => {
    root.innerHTML = `
      <div class="section-title">✅ Задания <small>выполняй и получай звёзды</small></div>
      ${S.tasks.map(t => `
        <div class="task ${t.done ? 'done' : ''}">
          <div class="task-ic">📣</div>
          <div class="task-body"><h4>${esc(t.title)}</h4><p>${esc(t.desc)}</p>
            <span class="task-rew">+${fmt(t.reward)} ★</span></div>
          <div class="task-act">
            ${t.done ? '<span class="badge paid">Выполнено ✓</span>'
              : !t.enabled ? '<span class="badge pending">Скоро</span>'
              : `<button class="btn sm ghost" data-open="${t.id}">Подписаться</button>
                 <button class="btn sm green" data-claim="${t.id}">Проверить</button>`}
          </div></div>`).join('')}
      <div class="soon">✨ Скоро появятся новые задания</div>`;
    $$('[data-open]', root).forEach(b => b.onclick = () => {
      const t = S.tasks.find(x => x.id === b.dataset.open);
      if (!t.url) return;
      if (tg && /^https:\/\/t\.me\//.test(t.url)) tg.openTelegramLink(t.url); else window.open(t.url, '_blank');
    });
    $$('[data-claim]', root).forEach(b => b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api('/api/task/claim', {task: b.dataset.claim});
        S.tasks = r.tasks; setBalance(r.balance); renderNav(); render();
        fx.winBig(4); toast(`+${r.reward} ★ за подписку!`, 'good');
      } catch (e) { toast(e.message, 'err'); b.disabled = false; }
    });
  };
  render();
}

/* ============================================================
   ПРОФИЛЬ
   ============================================================ */
const PSEL = new Set();
const WD_TXT = {pending: 'На модерации', paid: 'Выплачено', rejected: 'Отклонено', error: 'Ошибка'};

function viewProfile(root) {
  const u = S.user;
  const render = () => {
    PSEL.forEach(id => { if (!S.inv.some(i => i.id === id)) PSEL.delete(id); });
    const invVal = S.inv.reduce((s, r) => s + invItem(r).value, 0);
    const selSum = [...PSEL].reduce((s, id) => s + invItem(S.inv.find(i => i.id === id)).value, 0);
    root.innerHTML = `
      <div class="panel">
        <div class="prof-head">
          <div class="avatar">${u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : esc((u.name || '?')[0].toUpperCase())}</div>
          <div><div class="prof-name">${esc(u.name)}</div><div class="prof-id">ID ${u.id}${u.username ? ' · @' + esc(u.username) : ''}</div></div></div>
        <div class="big-bal"><small>Баланс</small><b>${fmt(u.balance)} ★</b>
          <div class="row"><button class="btn gold" id="depBtn">⬇ Пополнить</button><button class="btn ghost" id="wdBtn">⬆ Вывести</button></div></div>
        <div class="stats">
          <div class="stat"><b>${fmt(u.total_deposit)}</b><small>пополнено ★</small></div>
          <div class="stat"><b>${fmt(u.total_withdraw)}</b><small>выведено ★</small></div>
          <div class="stat"><b>${S.inv.length}</b><small>подарков</small></div></div>
      </div>
      ${S.withdrawals.length ? `<div class="section-title" style="font-size:16px">💸 Заявки на вывод</div>
        ${S.withdrawals.map(w => `<div class="wd-item"><span>#${w.id} · <b>${fmt(w.amount)} ★</b></span><span class="badge ${w.status}">${WD_TXT[w.status] || w.status}</span></div>`).join('')}` : ''}
      <div class="section-title">🎒 Инвентарь <small>${S.inv.length} шт · ${fmt(invVal)} ★</small></div>
      <div class="panel">
        ${S.inv.length ? `<div class="inv-head"><div class="chips"><button class="chip" id="selAll">Выбрать все</button>
            ${PSEL.size ? '<button class="chip" id="selNone">Снять</button>' : ''}</div>
          <button class="btn sm green" id="sellAll">Продать всё · ${fmt(invVal)} ★</button></div>
          <div class="tiles">${S.inv.map(r => tile(invItem(r), {cls: 'click ' + (PSEL.has(r.id) ? 'sel' : ''), attrs: `data-id="${r.id}"`})).join('')}</div>`
          : `<div class="empty"><span class="big">📦</span>Здесь пока пусто.<br>Открой кейс!</div>`}
      </div>
      ${PSEL.size ? `<div class="inv-bar"><div><b>${PSEL.size}</b> выбрано · <b style="color:var(--gold)">${fmt(selSum)} ★</b></div>
        <button class="btn sm green" id="sellSel">Продать</button></div>` : ''}`;
    $('#depBtn', root).onclick = openDeposit;
    $('#wdBtn', root).onclick = openWithdraw;
    $$('[data-id]', root).forEach(el => el.onclick = () => {
      const id = +el.dataset.id; PSEL.has(id) ? PSEL.delete(id) : PSEL.add(id); haptic('sel'); render();
    });
    const sa = $('#selAll', root); if (sa) sa.onclick = () => { S.inv.forEach(i => PSEL.add(i.id)); render(); };
    const sn = $('#selNone', root); if (sn) sn.onclick = () => { PSEL.clear(); render(); };
    const sell = async (all) => {
      try {
        const r = await api('/api/inventory/sell', all ? {all: true} : {ids: [...PSEL]});
        S.inv = r.inventory; PSEL.clear(); setBalance(r.balance);
        fx.burst(innerWidth / 2, innerHeight / 2, 5, 60); toast(`Продано ${r.sold} шт. за ${fmt(r.total)} ★`, 'good');
        render();
      } catch (e) { toast(e.message, 'err'); }
    };
    const sAll = $('#sellAll', root); if (sAll) sAll.onclick = () => sell(true);
    const sSel = $('#sellSel', root); if (sSel) sSel.onclick = () => sell(false);
  };
  render();
  const t = setInterval(() => { if (S.tab === 'profile') {} }, 60000);
  return () => clearInterval(t);
}

/* ---------------- пополнение / вывод ---------------- */
function openDeposit() {
  const m = openModal(`
    <h2>⬇ Пополнение</h2><div class="sub">Оплата Telegram Stars через платёжный бот</div>
    <input class="input" id="depIn" type="number" inputmode="numeric" placeholder="Сколько звёзд?" min="${S.cfg.min_deposit}" max="${S.cfg.max_deposit}">
    <div class="chips" style="margin:10px 0 16px">${[50, 100, 250, 500, 1000, 1500].map(n => `<button class="chip" data-a="${n}">${n} ★</button>`).join('')}</div>
    <button class="btn gold block" id="depGo">Перейти к оплате</button>
    <div class="pay-note">Вас перебросит во второй бот. После оплаты баланс пополнится автоматически, затем вернитесь сюда.<br>Минимум ${S.cfg.min_deposit} ★, максимум ${fmt(S.cfg.max_deposit)} ★.</div>`);
  const inp = $('#depIn', m.el);
  $$('[data-a]', m.el).forEach(b => b.onclick = () => { inp.value = b.dataset.a; haptic('sel'); });
  $('#depGo', m.el).onclick = async () => {
    const btn = $('#depGo', m.el); btn.disabled = true;
    try {
      const r = await api('/api/deposit/link', {amount: +inp.value});
      m.close();
      if (tg) tg.openTelegramLink(r.url); else window.open(r.url, '_blank');
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
  };
}

function openWithdraw() {
  const min = S.cfg.min_withdraw;
  const m = openModal(`
    <h2>⬆ Вывод звёзд</h2><div class="sub">Заявка уходит на модерацию, после одобрения вам делают выплату</div>
    <div class="field-label" style="margin-top:0"><span>Сумма</span><b>доступно ${fmt(S.user.balance)} ★</b></div>
    <input class="input" id="wdIn" type="number" inputmode="numeric" placeholder="От ${min} ★" min="${min}">
    <div class="chips" style="margin:10px 0 16px"><button class="chip" data-w="${min}">Мин ${min}</button><button class="chip" data-w="max">Всё</button></div>
    <button class="btn block" id="wdGo">Отправить заявку</button>
    <div class="pay-note">Минимальный вывод — ${min} ★. Звёзды списываются сразу; при отклонении заявки они вернутся на баланс.</div>`);
  const inp = $('#wdIn', m.el);
  $$('[data-w]', m.el).forEach(b => b.onclick = () => { inp.value = b.dataset.w === 'max' ? S.user.balance : b.dataset.w; haptic('sel'); });
  $('#wdGo', m.el).onclick = async () => {
    const btn = $('#wdGo', m.el); btn.disabled = true;
    try {
      const r = await api('/api/withdraw', {amount: +inp.value});
      S.withdrawals = r.withdrawals; setBalance(r.balance); m.close();
      toast('Заявка отправлена на модерацию ✅', 'good');
      if (S.tab === 'profile') go('profile');
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
  };
}

/* ============================================================
   Запуск
   ============================================================ */
async function refreshBalance() {
  if (!S.user || document.hidden) return;
  try {
    const r = await api('/api/balance');
    if (r.balance !== S.user.balance) { setBalance(r.balance); if (S.tab === 'profile' && !PSEL.size) go('profile'); }
  } catch (e) {}
}

async function boot() {
  const err = $('#loaderErr');
  if (!getInitData()) {
    err.textContent = 'Откройте приложение через Telegram-бота WensUP';
    $('.loader-bar').style.display = 'none';
    return;
  }
  try {
    const r = await api('/api/init');
    S.user = r.user; S.inv = r.inventory; S.cases = r.cases; S.tasks = r.tasks; S.feed = r.feed;
    S.mines = r.mines; S.withdrawals = r.withdrawals; S.cfg = r.cfg;
    S.gifts = Object.fromEntries(r.gifts.map(g => [g.key, g]));
  } catch (e) {
    err.textContent = e.message; $('.loader-bar').style.display = 'none'; return;
  }
  $('#app').hidden = false;
  setBalance(S.user.balance, false);
  $('#balChip').onclick = () => { haptic('light'); openDeposit(); };
  $('#logo').onclick = () => go('cases');
  go('cases');
  setTimeout(() => $('#loader').classList.add('gone'), 450);
  document.addEventListener('visibilitychange', refreshBalance);
  addEventListener('focus', refreshBalance);
  balancePoll = setInterval(refreshBalance, 8000);
  // лента «последних выигрышей» обновляется на главной
  setInterval(async () => {
    if (S.tab !== 'cases' || document.hidden || $('.modal')) return;
    try { const r = await api('/api/feed'); S.feed = r.feed; const b = $('#feedBox'); if (b) b.innerHTML = feedHTML(); } catch (e) {}
  }, 30000);
}
boot();
})();
