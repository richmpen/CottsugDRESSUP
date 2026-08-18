/* ============================================================
   COTTSUG · ОДЕВАШКА — app.js
   ------------------------------------------------------------
   Как всё устроено:

   1) Единая система координат. База (база.png) = 1158 × 3106
      «виртуальных пикселей». Любой объект — и вещь, и само тело —
      описывается ЦЕНТРОМ (x, y) в этих координатах + масштабом s
      + поворотом r + зеркалом f + слоем z. Всё в js/layout.js.

   2) На экране слои позиционируются в ПРОЦЕНТАХ от сцены:
        left  = x / 1158 * 100 %
        top   = y / 3106 * 100 %
        width = (натуральная_ширина * s) / 1158 * 100 %
      Поэтому при любом размере экрана всё сходится пиксель-в-пиксель.

   3) Тело — обычный слой с ключом "base/0" и z = 0. Вещи с
      отрицательным z уезжают ПОД тело.

   4) БЕТА-режим двигает объекты руками и выгружает готовый
      layout.js — те самые «логи позиций».
   ============================================================ */

(() => {
'use strict';

/* ---------------- утилиты ---------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = (v, d = 0) => { const k = 10 ** d; return Math.round(v * k) / k; };
const rnd   = (a, b) => a + Math.random() * (b - a);
const calm  = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
/** телефон/планшет-тач: тут эффекты с эмодзи отключены — они плодят
    десятки узлов и заметно дёргают слабые устройства */
const phone = () => matchMedia('(max-width:760px)').matches || matchMedia('(hover:none)').matches;
const noFx  = () => calm() || phone();

/** путь → безопасный URL (папки кириллицей) */
const url = p => p.split('/').map(encodeURIComponent).join('/');

const LS = {
  outfit: 'cottsug.outfit.v2',
  layout: 'cottsug.layout.v2',
  ui    : 'cottsug.ui.v2',
  sound : 'cottsug.sound.v1'
};
const readLS  = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
const writeLS = (k, v)  => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/* ---------------- данные ---------------- */
const BASE  = window.BASE;
const CATS  = window.CATEGORIES;
const ITEMS = window.ITEMS;
const ANCH  = window.ANCHORS;

const CONFIG = Object.assign({ beta: true }, window.CONFIG || {});

const BASE_CAT = { id: 'base', dir: '', name: BASE.name || 'Тело', emoji: '🧍', z: 0 };
const CAT_BY_ID = Object.fromEntries([...CATS, BASE_CAT].map(c => [c.id, c]));

const FILE_LAYOUT   = JSON.parse(JSON.stringify(window.LAYOUT || {}));
const FILE_SETTINGS = JSON.parse(JSON.stringify(window.SETTINGS || { cardSize: 92 }));
/* В боевом режиме (CONFIG.beta = false) правки из памяти браузера
   НЕ подмешиваются — сайт показывает ровно то, что лежит в layout.js. */
let   layout   = CONFIG.beta ? Object.assign({}, FILE_LAYOUT, readLS(LS.layout, {}))
                             : JSON.parse(JSON.stringify(FILE_LAYOUT));
let   settings = CONFIG.beta ? Object.assign({}, FILE_SETTINGS, readLS(LS.ui, {}))
                             : JSON.parse(JSON.stringify(FILE_SETTINGS));

const isBase = cat => cat === 'base';
const meta   = (cat, n) => isBase(cat) ? { n: 0, w: BASE.w, h: BASE.h } : ITEMS[cat].find(i => i.n === n);
const key    = (cat, n) => `${cat}/${n}`;
const bigSrc = (cat, n) => isBase(cat) ? BASE.src : `items/${CAT_BY_ID[cat].dir}/${n}.png`;
const thumbSrc = (cat, n) => isBase(cat) ? 'assets/thumbs/base/0.png' : `assets/thumbs/${cat}/${n}.png`;

/** позиция объекта; если её нет в layout — считаем по якорю категории */
function pos(cat, n){
  const k = key(cat, n);
  if (layout[k]){
    const p = layout[k];
    if (p.ts == null) p.ts = 1;      // масштаб иконки
    if (p.tx == null) p.tx = 0;      // сдвиг иконки по X, % от карточки
    if (p.ty == null) p.ty = 0;      // сдвиг иконки по Y
    if (p.tr == null) p.tr = 0;      // поворот иконки, градусы
    return p;
  }
  const m = meta(cat, n);
  const auto = isBase(cat)
    ? { x: BASE.w / 2, y: BASE.h / 2, s: 1, r: 0, f: 1, z: 0, ts: 1, tx: 0, ty: 0, tr: 0 }
    : (() => { const a = ANCH[cat];
        return { x: a.cx, y: a.cy, s: round(a.targetW / m.w, 4), r: 0, f: 1,
                 z: CAT_BY_ID[cat].z, ts: 1, tx: 0, ty: 0, tr: 0 }; })();
  layout[k] = auto;
  return auto;
}

/* ---------------- состояние ---------------- */
/** сколько вещей категории можно носить одновременно */
const limitOf = cat => Math.max(1, CAT_BY_ID[cat]?.limit || 1);

/** worn хранит МАССИВЫ: { top:[2,9], accessories:[1,3,5] }.
    Старые сохранения с одиночными числами подхватываются как есть. */
function normWorn(raw){
  const out = {};
  Object.entries(raw || {}).forEach(([cat, v]) => {
    if (!ITEMS[cat]) return;
    const arr = (Array.isArray(v) ? v : [v]).filter(n => ITEMS[cat].some(i => i.n === n));
    if (arr.length) out[cat] = arr.slice(-limitOf(cat));
  });
  return out;
}

let worn      = {};                              // { catId: [n, ...] } — заполняется ниже
let betaOn    = false;
let picked    = null;                            // { cat, n }
let soundOn   = readLS(LS.sound, true);
let activeTab = CATS[0].id;
let dim       = 1;                               // прозрачность слоёв в БЕТЕ

const layerEls  = new Map();                     // 'cat/n' → <img>
const alphaMaps = new Map();                     // 'cat/n' → {w,h,a} | 'no'

/** всё, что сейчас на сцене, включая тело */
const onStage = () => [{ cat: 'base', n: 0 },
  ...CATS.flatMap(c => (worn[c.id] || []).map(n => ({ cat: c.id, n })))];

/** надета ли конкретная вещь */
const isWorn = (cat, n) => (worn[cat] || []).includes(n);

/* ---------------- DOM ---------------- */
const app     = $('#app');
const stage   = $('#stage');
const inner   = $('#stageInner');
const baseImg = $('#baseImg');
const guides  = $('#guides');
const shelf   = $('#shelf');
const tabsEl  = $('#tabs');
const wornEl  = $('#worn');
const toastEl = $('#toast');
const loader  = $('#loader');

/* ============================================================
   ЗВУК — мягкие «блипы» на WebAudio, без внешних файлов
   ============================================================ */
let actx = null;
function blip(freq = 660, dur = .08, type = 'sine', gain = .05){
  if (!soundOn) return;
  try{
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, actx.currentTime);
    g.gain.linearRampToValueAtTime(gain, actx.currentTime + .012);
    g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur + .02);
  }catch{}
}
const sndOn  = () => { blip(760, .09); setTimeout(() => blip(1020, .1), 55); };
const sndOff = () => blip(520, .08, 'triangle');
const sndTap = () => blip(880, .05, 'sine', .035);
const sndWow = () => { [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => blip(f, .09, 'sine', .04), i * 70)); };

/* ============================================================
   РАЗМЕР СЦЕНЫ — держим точные пропорции базы
   ============================================================ */
function fitStage(){
  const card = stage.parentElement;
  const cw = card.clientWidth  - 26;
  const ch = card.clientHeight - 26;
  if (cw <= 0 || ch <= 0) return;
  const ratio = BASE.w / BASE.h;
  let h = ch, w = h * ratio;
  if (w > cw){ w = cw; h = w / ratio; }
  stage.style.width  = w + 'px';
  stage.style.height = h + 'px';

  // карточка не шире, чем нужно персонажу (иначе много пустого белого)
  const want = Math.round(h * ratio + 120);
  if (card.dataset.mw !== String(want)){
    card.dataset.mw = String(want);
    card.style.maxWidth = want + 'px';
  }
}
new ResizeObserver(fitStage).observe($('.doll__card'));
addEventListener('orientationchange', () => setTimeout(fitStage, 250));

/* ============================================================
   СЛОИ ПЕРСОНАЖА
   ============================================================ */
function applyPos(el, cat, n){
  const p = pos(cat, n), m = meta(cat, n);
  el.style.left   = (p.x / BASE.w * 100) + '%';
  el.style.top    = (p.y / BASE.h * 100) + '%';
  el.style.width  = (m.w * p.s / BASE.w * 100) + '%';
  el.style.height = (m.h * p.s / BASE.h * 100) + '%';   // высота ЯВНО:
  // иначе до загрузки картинки height=0, translate(-50%,-50%) центрует
  // по нулю, и вещь «спавнится» не на месте, а потом прыгает.
  el.style.zIndex = p.z;
  const tf = `translate(-50%,-50%) rotate(${p.r}deg) scaleX(${p.f})`;
  el.style.setProperty('--tf', tf);
  el.style.transform = tf;
  el.style.opacity = (dim < 1 && !isBase(cat)) ? dim : '';
}

let pending = 0;
function setLoading(on){
  pending = Math.max(0, pending + (on ? 1 : -1));
  loader.classList.toggle('is-on', pending > 0);
}

function makeLayer(cat, n, fresh){
  const img = new Image();
  img.className = 'layer' + (fresh ? ' is-new' : '');
  img.draggable = false;
  img.decoding = 'async';
  img.alt = `${CAT_BY_ID[cat].name} №${n}`;
  img.dataset.cat = cat; img.dataset.n = n;
  setLoading(true);
  img.onload  = () => setLoading(false);
  img.onerror = () => { setLoading(false); toast('Не нашлось: ' + bigSrc(cat, n)); };
  img.src = url(bigSrc(cat, n));
  applyPos(img, cat, n);
  inner.appendChild(img);
  layerEls.set(key(cat, n), img);
  return img;
}

function dropLayer(cat, n){
  const el = layerEls.get(key(cat, n));
  if (el){
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
    layerEls.delete(key(cat, n));
  }
  if (picked && picked.cat === cat && picked.n === n) pick(null);
}

function wear(cat, n, { silent = false } = {}){
  const list = [...(worn[cat] || [])];

  if (n == null){                       // «снять» — чистим всю категорию
    list.forEach(x => dropLayer(cat, x));
    delete worn[cat];
    if (!silent && list.length) sndOff();

  } else if (list.includes(n)){         // повторный клик — снимаем именно её
    dropLayer(cat, n);
    list.splice(list.indexOf(n), 1);
    if (list.length) worn[cat] = list; else delete worn[cat];
    if (!silent) sndOff();

  } else {                              // надеваем
    list.push(n);
    while (list.length > limitOf(cat)) dropLayer(cat, list.shift());
    worn[cat] = list;
    makeLayer(cat, n, true);
    if (!silent){ sndOn(); burst(); }
  }

  writeLS(LS.outfit, worn);
  paintShelf(); paintWorn();
}

function rebuildAll(){
  [...layerEls.entries()].forEach(([k, el]) => { if (k !== 'base/0') el.remove(); });
  layerEls.clear();
  layerEls.set('base/0', baseImg);
  applyPos(baseImg, 'base', 0);
  CATS.forEach(c => (worn[c.id] || []).forEach(n => makeLayer(c.id, n, false)));
  paintShelf(); paintWorn();
}

/* ============================================================
   ЭФФЕКТЫ (только десктоп — на телефоне отключены)
   ============================================================ */
const GLYPHS = ['♥', '🍓', '✦', '🎀', '✧', '🌸', '💗'];

function burst(n = 8){
  if (noFx()) return;
  const r = stage.getBoundingClientRect();
  for (let i = 0; i < n; i++){
    const s = document.createElement('span');
    s.className = 'heart';
    s.textContent = GLYPHS[(Math.random() * GLYPHS.length) | 0];
    s.style.left = (r.left + r.width * rnd(.18, .82)) + 'px';
    s.style.top  = (r.top  + r.height * rnd(.22, .62)) + 'px';
    s.style.setProperty('--dx', rnd(-55, 55) + 'px');
    s.style.setProperty('--rot', rnd(-35, 35) + 'deg');
    s.style.fontSize = rnd(15, 26) + 'px';
    s.style.animationDelay = (i * 42) + 'ms';
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1300 + i * 42);
  }
}

function sparkleAt(cx, cy){
  if (noFx() || !cx) return;
  for (let i = 0; i < 6; i++){
    const s = document.createElement('span');
    s.className = 'sparkle';
    s.textContent = i % 3 === 0 ? '🍓' : '✦';
    const a = (Math.PI * 2 * i) / 6 + rnd(-.4, .4), d = rnd(26, 54);
    s.style.left = cx + 'px'; s.style.top = cy + 'px';
    s.style.setProperty('--tx', Math.cos(a) * d + 'px');
    s.style.setProperty('--ty', Math.sin(a) * d + 'px');
    s.style.fontSize = rnd(10, 17) + 'px';
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 800);
  }
}

function berryRain(n = 26){
  if (noFx()) return;
  for (let i = 0; i < n; i++){
    const s = document.createElement('span');
    s.className = 'rain';
    s.textContent = ['🍓', '✦', '🎀', '💗', '🌸'][(Math.random() * 5) | 0];
    s.style.left = rnd(0, 100) + 'vw';
    s.style.fontSize = rnd(14, 32) + 'px';
    s.style.animationDelay = rnd(0, .55) + 's';
    s.style.animationDuration = rnd(1.9, 3.2) + 's';
    s.style.setProperty('--sway', rnd(-70, 70) + 'px');
    s.style.setProperty('--spin', rnd(-420, 420) + 'deg');
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 4200);
  }
}

/* ============================================================
   ГАРДЕРОБ
   ============================================================ */
function buildTabs(){
  tabsEl.innerHTML = '';
  CATS.forEach(c => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.cat = c.id;
    b.innerHTML = `<span>${c.emoji}</span>${c.name}<em>${ITEMS[c.id].length}</em>`;
    b.setAttribute('aria-selected', String(c.id === activeTab));
    b.onclick = e => {
      activeTab = c.id; sndTap();
      sparkleAt(e.clientX, e.clientY);
      buildTabs(); paintShelf(true);
    };
    tabsEl.appendChild(b);
  });
}

function paintShelf(soft){
  const cat = activeTab;
  const list = ITEMS[cat];
  if (soft || shelf.dataset.cat !== cat){
    shelf.dataset.cat = cat;
    shelf.innerHTML = '';

    const none = document.createElement('button');
    none.className = 'card card--none';
    none.type = 'button';
    none.innerHTML = '<b>снять</b>';
    none.onclick = () => wear(cat, null);
    shelf.appendChild(none);

    list.forEach((it, i) => {
      const b = document.createElement('button');
      b.className = 'card';
      b.type = 'button';
      b.dataset.n = it.n;
      b.style.setProperty('--d', (i * 32) + 'ms');
      applyIconVars(b, cat, it.n);
      b.innerHTML =
        `<img loading="lazy" decoding="async" fetchpriority="low" src="${url(thumbSrc(cat, it.n))}" alt="${CAT_BY_ID[cat].name} ${it.n}"` +
        ` onerror="this.src='${url(bigSrc(cat, it.n))}'">` +
        `<span class="card__num">${it.n}</span><i class="card__shine"></i>`;
      b.onclick = e => {
        sparkleAt(e.clientX, e.clientY);
        if (betaOn && isWorn(cat, it.n)){ pick({ cat, n: it.n }); return; }
        wear(cat, it.n);
        if (betaOn && isWorn(cat, it.n)) pick({ cat, n: it.n });
      };
      shelf.appendChild(b);
    });
  }
  $$('.card', shelf).forEach(c => {
    if (!c.dataset.n) return;
    const n = +c.dataset.n;
    c.classList.toggle('is-on', isWorn(cat, n));
    applyIconVars(c, cat, n);
  });
  const lim = limitOf(cat);
  const cnt = (worn[cat] || []).length;
  $('#wardrobeCount').textContent = `· на персонаже ${onStage().length - 1} вещей` +
    (lim > 1 ? ` · в этой категории ${cnt} из ${lim === 99 ? ITEMS[cat].length : lim}` : '');
}

function paintWorn(){
  wornEl.innerHTML = '';
  const list = betaOn ? onStage() : onStage().filter(o => o.cat !== 'base');
  list.forEach(({ cat, n }) => {
    const c = CAT_BY_ID[cat];
    const chip = document.createElement('button');
    chip.className = 'worn__chip' + (isBase(cat) ? ' worn__chip--base' : '');
    chip.type = 'button';
    chip.title = betaOn ? 'Взять для настройки' : 'Снять';
    if (!isBase(cat)) applyIconVars(chip, cat, n);
    chip.innerHTML =
      `<img src="${url(thumbSrc(cat, n))}" alt="" onerror="this.style.display='none'">` +
      `<span>${c.name}${isBase(cat) ? '' : ' ' + n}</span><i>${betaOn ? '✎' : '✕'}</i>`;
    chip.onclick = () => betaOn ? pick({ cat, n }) : wear(cat, null);
    wornEl.appendChild(chip);
  });
}

/** переменные вида иконки на элемент карточки (или превью в БЕТЕ) */
function applyIconVars(el, cat, n){
  const p = pos(cat, n);
  el.style.setProperty('--ts', p.ts ?? 1);
  el.style.setProperty('--tx', (p.tx ?? 0) + '%');
  el.style.setProperty('--ty', (p.ty ?? 0) + '%');
  el.style.setProperty('--tr', (p.tr ?? 0) + 'deg');
}

function applyCardSize(){
  shelf.style.setProperty('--card', settings.cardSize + 'px');
}

/* ============================================================
   ДЕЙСТВИЯ В ШАПКЕ
   ============================================================ */
function randomize(){
  // Пустых категорий не бывает: «Снять» в рандоме не выпадает никогда.
  const next = {};
  CATS.forEach(c => {
    const pool = ITEMS[c.id].map(i => i.n);
    const cap = Math.min(limitOf(c.id), pool.length, c.id === 'accessories' ? 3 : 2);
    const take = 1 + ((Math.random() * cap) | 0);
    const bag = [...pool];
    const got = [];
    for (let i = 0; i < take && bag.length; i++)
      got.push(...bag.splice((Math.random() * bag.length) | 0, 1));
    next[c.id] = got;
  });
  worn = next;
  writeLS(LS.outfit, worn);
  rebuildAll();

  // тело не анимируем — иначе оно «прыгает»
  $$('.layer:not(.layer--base)', inner).forEach((el, i) => {
    el.classList.remove('is-new'); void el.offsetWidth;
    el.style.animationDelay = (i * 55) + 'ms';
    el.classList.add('is-new');
  });
  sndWow(); berryRain(); burst(10);
  toast('Новый образ! 🎲');
}

function clearAll(){
  worn = {};
  writeLS(LS.outfit, worn);
  rebuildAll();
  pick(null);
  sndOff();
  toast('Всё снято 🧺');
}

/* ---------- сохранение картинки ---------- */
async function screenshot(){
  const M = 220;
  const cv = $('#shotCanvas');
  cv.width = BASE.w + M * 2;
  cv.height = BASE.h + M * 2;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);

  const load = src => new Promise(res => {
    const im = new Image();
    im.onload = () => res(im); im.onerror = () => res(null);
    im.src = url(src);
  });

  const jobs = onStage().map(({ cat, n }) => {
    const p = pos(cat, n), m = meta(cat, n);
    return { z: p.z, src: bigSrc(cat, n), p, w: m.w, h: m.h };
  }).sort((a, b) => a.z - b.z);

  setLoading(true);
  const imgs = await Promise.all(jobs.map(j => load(j.src)));
  setLoading(false);

  jobs.forEach((j, i) => {
    const im = imgs[i]; if (!im) return;
    const w = j.w * j.p.s, h = j.h * j.p.s;
    ctx.save();
    ctx.translate(M + j.p.x, M + j.p.y);
    ctx.rotate((j.p.r || 0) * Math.PI / 180);
    ctx.scale(j.p.f || 1, 1);
    ctx.drawImage(im, -w / 2, -h / 2, w, h);
    ctx.restore();
  });

  ctx.font = '700 52px Nunito, sans-serif';
  ctx.fillStyle = '#f291bb';
  ctx.textAlign = 'right';
  ctx.fillText('🍓 art by @cottsug · t.me/cottsug', cv.width - M / 2, cv.height - M / 3);

  try{
    cv.toBlob(b => {
      if (!b){ toast('Браузер не отдал картинку — запусти сайт через start.bat'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'cottsug-look.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Картинка сохранена 📸');
      sndOn(); berryRain(14);
    }, 'image/png');
  }catch{
    toast('Картинку не собрать из файла — открой сайт через start.bat 🍓');
  }
}

/* ============================================================
   БЕТА-РЕЖИМ
   ============================================================ */
function setBeta(on){
  if (!CONFIG.beta) return;
  betaOn = on;
  $('#beta').hidden = !on;
  app.classList.toggle('is-beta', on);
  $('#btnBeta').classList.toggle('is-on', on);
  guides.classList.toggle('is-on', on && $('#bGuides').checked);
  if (!on){ pick(null); dim = 1; $$('.layer', inner).forEach(el => el.style.opacity = ''); }
  paintWorn(); paintState();
  toast(on ? '🛠️ БЕТА: тяни вещи и тело мышкой или пальцем' : 'БЕТА выключена');
}

function pick(sel){
  if (picked){
    const el = layerEls.get(key(picked.cat, picked.n));
    el && el.classList.remove('is-picked');
  }
  picked = sel;
  if (sel){
    const el = layerEls.get(key(sel.cat, sel.n));
    el && el.classList.add('is-picked');
    if (!isBase(sel.cat) && activeTab !== sel.cat){ activeTab = sel.cat; buildTabs(); paintShelf(true); }
  }
  syncFields();
}

function syncFields(){
  if (!CONFIG.beta) return;
  const on = !!picked;
  const c = on ? CAT_BY_ID[picked.cat] : null;
  $('#betaSel').textContent = on
    ? (isBase(picked.cat)
        ? '🧍 Тело   («base/0»)'
        : `${c.emoji} ${c.name} · №${picked.n}   («${key(picked.cat, picked.n)}»)`)
    : '— ничего не выбрано —';
  const icoFields = ['#fts', '#ftx', '#fty', '#ftr'];
  ['#fx', '#fy', '#fs', '#fr', '#fz'].forEach(s => $(s).disabled = !on);
  icoFields.forEach(s => $(s).disabled = !on || isBase(picked.cat));
  $('#iconEd').classList.toggle('is-off', !on || isBase(picked.cat));
  if (!on) return;
  const p = pos(picked.cat, picked.n);
  $('#fx').value  = round(p.x, 1);
  $('#fy').value  = round(p.y, 1);
  $('#fs').value  = round(p.s, 4);
  $('#fr').value  = round(p.r, 1);
  $('#fz').value  = p.z;
  $('#fts').value = round(p.ts ?? 1, 3);
  $('#ftx').value = round(p.tx ?? 0, 1);
  $('#fty').value = round(p.ty ?? 0, 1);
  $('#ftr').value = round(p.tr ?? 0, 1);
  paintIconPreview();
}

/** живое превью иконки в БЕТА-панели */
function paintIconPreview(){
  const box = $('#iconBox'), img = $('#iconImg');
  if (!box || !picked || isBase(picked.cat)) return;
  applyIconVars(box, picked.cat, picked.n);
  const src = url(thumbSrc(picked.cat, picked.n));
  if (img.dataset.src !== src){
    img.dataset.src = src;
    img.src = src;
    img.onerror = () => { img.src = url(bigSrc(picked.cat, picked.n)); };
  }
}

/** сколько объектов отличается от того, что лежит в js/layout.js */
function dirtyCount(){
  let n = 0;
  const keys = new Set([...Object.keys(layout), ...Object.keys(FILE_LAYOUT)]);
  keys.forEach(k => {
    const a = layout[k], b = FILE_LAYOUT[k];
    if (!b) return;                     // авто-позиция для новой вещи — не считаем
    if (!a) { n++; return; }
    if (['x','y','s','r','f','z','ts','tx','ty','tr'].some(f =>
        round(a[f] ?? (f==='ts'?1:0), 4) !== round(b[f] ?? (f==='ts'?1:0), 4))) n++;
  });
  if (settings.cardSize !== FILE_SETTINGS.cardSize) n++;
  return n;
}

function paintState(){
  const el = $('#betaState');
  if (!el || !CONFIG.beta) return;
  const n = dirtyCount();
  el.classList.toggle('is-dirty', n > 0);
  el.textContent = n > 0
    ? `Изменено объектов: ${n}. Пока правки живут только в этом браузере — нажми «Скачать файл» и положи layout.js в папку js/, чтобы закрепить насовсем.`
    : 'Всё совпадает с файлом js/layout.js — терять нечего.';
}

function commit(){
  if (!picked) return;
  const el = layerEls.get(key(picked.cat, picked.n));
  el && applyPos(el, picked.cat, picked.n);
  writeLS(LS.layout, layout);
  syncFields(); paintState();
}

const nudge = (dx, dy) => { if (!picked) return; const p = pos(picked.cat, picked.n);
  p.x = round(p.x + dx, 1); p.y = round(p.y + dy, 1); commit(); };
const scaleBy = k => { if (!picked) return; const p = pos(picked.cat, picked.n);
  p.s = round(clamp(p.s * k, .03, 6), 4); commit(); };
const rotBy = d => { if (!picked) return; const p = pos(picked.cat, picked.n);
  p.r = round(p.r + d, 1); commit(); };
const zBy = d => { if (!picked) return; const p = pos(picked.cat, picked.n);
  p.z = clamp(p.z + d, -99, 999); commit(); };

/* --- альфа-хиттест: клик «сквозь» прозрачные места --- */
function alphaMap(cat, n){
  const k = key(cat, n);
  if (alphaMaps.has(k)) return alphaMaps.get(k);
  const img = layerEls.get(k);
  if (!img || !img.complete || !img.naturalWidth) return null;
  try{
    const W = 140, H = Math.max(1, Math.round(W * img.naturalHeight / img.naturalWidth));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, W, H);
    const d = cx.getImageData(0, 0, W, H).data;
    const a = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) a[i] = d[i * 4 + 3];
    const m = { w: W, h: H, a };
    alphaMaps.set(k, m);
    return m;
  }catch{
    alphaMaps.set(k, 'no');   // file:// — canvas «испорчен», работаем по рамке
    return 'no';
  }
}

function hitLayer(cat, n, cxp, cyp){
  if (!layerEls.get(key(cat, n))) return false;
  const r = stage.getBoundingClientRect();
  const k = r.width / BASE.w;
  const p = pos(cat, n), m = meta(cat, n);

  const bx = (cxp - r.left) / k, by = (cyp - r.top) / k;
  const ux = bx - p.x, uy = by - p.y;
  const a = -(p.r || 0) * Math.PI / 180;
  const rx = ux * Math.cos(a) - uy * Math.sin(a);
  const ry = ux * Math.sin(a) + uy * Math.cos(a);
  const lx = (rx * (p.f || 1)) / p.s + m.w / 2;
  const ly = ry / p.s + m.h / 2;
  if (lx < 0 || ly < 0 || lx > m.w || ly > m.h) return false;

  const map = alphaMap(cat, n);
  if (!map || map === 'no') return true;
  const px = clamp((lx / m.w * map.w) | 0, 0, map.w - 1);
  const py = clamp((ly / m.h * map.h) | 0, 0, map.h - 1);
  return map.a[py * map.w + px] > 24;
}

const layerAt = (cxp, cyp) => onStage()
  .map(o => ({ ...o, z: pos(o.cat, o.n).z }))
  .sort((a, b) => b.z - a.z)
  .find(o => hitLayer(o.cat, o.n, cxp, cyp)) || null;

/* --- перетаскивание / щипок --- */
const ptrs = new Map();
let drag = null;

stage.addEventListener('pointerdown', e => {
  if (!betaOn) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (ptrs.size === 1){
    const hit = layerAt(e.clientX, e.clientY);
    if (hit && (!picked || picked.cat !== hit.cat || picked.n !== hit.n)) pick(hit);
    if (!picked) return;
    const p = pos(picked.cat, picked.n);
    drag = { mode: 'move', sx: e.clientX, sy: e.clientY, px: p.x, py: p.y };
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  } else if (ptrs.size === 2 && picked){
    const [a, b] = [...ptrs.values()];
    const p = pos(picked.cat, picked.n);
    drag = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y),
             a0: Math.atan2(b.y - a.y, b.x - a.x), s0: p.s, r0: p.r };
  }
});

stage.addEventListener('pointermove', e => {
  if (!betaOn || !drag || !ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const r = stage.getBoundingClientRect();
  const k = r.width / BASE.w;
  const p = pos(picked.cat, picked.n);

  if (drag.mode === 'move' && ptrs.size === 1){
    p.x = round(drag.px + (e.clientX - drag.sx) / k, 1);
    p.y = round(drag.py + (e.clientY - drag.sy) / k, 1);
    commit();
  } else if (drag.mode === 'pinch' && ptrs.size >= 2){
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    p.s = round(clamp(drag.s0 * (d / drag.d0), .03, 6), 4);
    p.r = round(drag.r0 + (ang - drag.a0) * 180 / Math.PI, 1);
    commit();
  }
  e.preventDefault();
}, { passive: false });

['pointerup', 'pointercancel'].forEach(ev =>
  stage.addEventListener(ev, e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0) drag = null;
    if (ptrs.size === 1 && drag && drag.mode === 'pinch' && picked){
      const [a] = [...ptrs.values()];
      const p = pos(picked.cat, picked.n);
      drag = { mode: 'move', sx: a.x, sy: a.y, px: p.x, py: p.y };
    }
  })
);

stage.addEventListener('wheel', e => {
  if (!betaOn || !picked) return;
  e.preventDefault();
  if (e.shiftKey) rotBy(e.deltaY > 0 ? 1.5 : -1.5);
  else scaleBy(e.deltaY > 0 ? .975 : 1.025);
}, { passive: false });

/* --- поля ввода и вся проводка панели (только в БЕТА-режиме) --- */
if (CONFIG.beta){

const bind = (sel, prop, fix, after) => $(sel).addEventListener('input', () => {
  if (!picked) return;
  const v = parseFloat($(sel).value);
  if (Number.isNaN(v)) return;
  pos(picked.cat, picked.n)[prop] = fix ? fix(v) : v;
  const el = layerEls.get(key(picked.cat, picked.n));
  el && applyPos(el, picked.cat, picked.n);
  writeLS(LS.layout, layout);
  paintState();
  after && after();
});
bind('#fx', 'x'); bind('#fy', 'y');
bind('#fs', 's', v => clamp(v, .03, 6));
bind('#fr', 'r');
bind('#fz', 'z', v => clamp(Math.round(v), -99, 999));
const afterIcon = () => { paintShelf(); paintWorn(); paintIconPreview(); };
bind('#fts', 'ts', v => clamp(v, .1, 4),    afterIcon);
bind('#ftx', 'tx', v => clamp(v, -200, 200), afterIcon);
bind('#fty', 'ty', v => clamp(v, -200, 200), afterIcon);
bind('#ftr', 'tr', v => clamp(v, -180, 180), afterIcon);

$('#bFlip').onclick  = () => { if (!picked) return; const p = pos(picked.cat, picked.n); p.f = (p.f || 1) * -1; commit(); };
$('#bZup').onclick   = () => zBy(1);
$('#bZdn').onclick   = () => zBy(-1);
$('#bBody').onclick  = () => pick({ cat: 'base', n: 0 });
$('#bReset').onclick = () => {
  if (!picked) return;
  const k = key(picked.cat, picked.n);
  if (FILE_LAYOUT[k]) layout[k] = JSON.parse(JSON.stringify(FILE_LAYOUT[k]));
  else delete layout[k];
  commit(); paintShelf(); paintState(); toast('Объект вернулся к исходной позиции');
};
$('#bIconReset').onclick = () => {
  if (!picked || isBase(picked.cat)) return;
  const p = pos(picked.cat, picked.n);
  p.ts = 1; p.tx = 0; p.ty = 0; p.tr = 0;
  writeLS(LS.layout, layout);
  syncFields(); paintShelf(); paintWorn(); paintState();
};

/* превью иконки: тянем мышкой/пальцем, колесо — масштаб, Shift+колесо — поворот */
(() => {
  const box = $('#iconBox');
  if (!box) return;
  let d = null;
  box.addEventListener('pointerdown', e => {
    if (!picked || isBase(picked.cat)) return;
    const p = pos(picked.cat, picked.n);
    d = { sx: e.clientX, sy: e.clientY, tx: p.tx ?? 0, ty: p.ty ?? 0, w: box.clientWidth || 1 };
    box.setPointerCapture(e.pointerId);
    box.classList.add('is-grab');
    e.preventDefault();
  });
  box.addEventListener('pointermove', e => {
    if (!d) return;
    const p = pos(picked.cat, picked.n);
    p.tx = round(clamp(d.tx + (e.clientX - d.sx) / d.w * 100, -200, 200), 1);
    p.ty = round(clamp(d.ty + (e.clientY - d.sy) / d.w * 100, -200, 200), 1);
    writeLS(LS.layout, layout);
    syncFields(); paintShelf(); paintWorn(); paintState();
  });
  ['pointerup', 'pointercancel'].forEach(ev =>
    box.addEventListener(ev, () => { d = null; box.classList.remove('is-grab'); }));
  box.addEventListener('wheel', e => {
    if (!picked || isBase(picked.cat)) return;
    e.preventDefault();
    const p = pos(picked.cat, picked.n);
    if (e.shiftKey) p.tr = round(clamp((p.tr ?? 0) + (e.deltaY > 0 ? 3 : -3), -180, 180), 1);
    else            p.ts = round(clamp((p.ts ?? 1) * (e.deltaY > 0 ? .94 : 1.06), .1, 4), 3);
    writeLS(LS.layout, layout);
    syncFields(); paintShelf(); paintWorn(); paintState();
  }, { passive: false });
})();

$('#bGuides').onchange = e => guides.classList.toggle('is-on', betaOn && e.target.checked);
$('#bOpacity').oninput = e => {
  dim = e.target.value / 100;
  $('#bOpacityV').textContent = e.target.value + '%';
  $$('.layer', inner).forEach(el => {
    el.style.opacity = (dim < 1 && !el.classList.contains('layer--base')) ? dim : '';
  });
};
$('#bCards').oninput = e => {
  settings.cardSize = +e.target.value;
  $('#bCardsV').textContent = settings.cardSize + 'px';
  applyCardSize(); writeLS(LS.ui, settings); paintState();
};
$('#betaClose').onclick = () => setBeta(false);

}   /* конец проводки БЕТА-панели */

/* --- выгрузка layout.js --- */
function layoutSource(){
  const head =
`/* ============================================================
   COTTSUG · ОДЕВАШКА  ·  t.me/cottsug
   layout.js — ПОЗИЦИИ ВЕЩЕЙ НА ТЕЛЕ.
   Выгружено из БЕТА-режима.
   ------------------------------------------------------------
   "категория/номер": { x, y, s, r, f, z, ts }
     x, y — центр картинки в координатах базы (${BASE.w} × ${BASE.h})
     s    — масштаб (1 = натуральный размер PNG)
     r    — поворот, градусы
     f    — 1 обычно / -1 зеркально
     z    — слой (тело = 0, минус — под телом)
     ts   — масштаб иконки в гардеробе
     tx,ty— сдвиг иконки внутри карточки, % от её размера
     tr   — поворот иконки, градусы
   ============================================================ */

window.SETTINGS = {
  cardSize: ${settings.cardSize}
};

window.LAYOUT = {

  /* ---- ТЕЛО ---- */
`;
  const row = (cat, n) => {
    const p = pos(cat, n);
    const k = `"${key(cat, n)}":`.padEnd(20, ' ');
    return `  ${k}{ x: ${round(p.x, 1)}, y: ${round(p.y, 1)}, s: ${round(p.s, 4)}, r: ${round(p.r, 1)}, f: ${p.f || 1}, z: ${p.z}` +
           `, ts: ${round(p.ts ?? 1, 3)}, tx: ${round(p.tx ?? 0, 1)}, ty: ${round(p.ty ?? 0, 1)}, tr: ${round(p.tr ?? 0, 1)} }`;
  };
  const chunks = CATS.map(c =>
    `  /* ---- ${c.name.toUpperCase()} (${c.dir}) ---- */\n` +
    ITEMS[c.id].map(it => row(c.id, it.n)).join(',\n')
  ).join(',\n\n');
  return head + row('base', 0) + ',\n\n' + chunks + '\n};\n';
}

if (CONFIG.beta){

$('#bCopy').onclick = async () => {
  const src = layoutSource();
  try{
    await navigator.clipboard.writeText(src);
    toast('Скопировано! Вставь в js/layout.js 📋');
  }catch{
    console.log(src);
    toast('Не вышло в буфер — код выведен в консоль (F12)');
  }
};

$('#bDownload').onclick = () => {
  const b = new Blob([layoutSource()], { type: 'text/javascript;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'layout.js';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('layout.js скачан — положи его в папку js/ 💾');
};

$('#bWipe').onclick = () => {
  layout = JSON.parse(JSON.stringify(FILE_LAYOUT));
  settings = JSON.parse(JSON.stringify(FILE_SETTINGS));
  try{ localStorage.removeItem(LS.layout); localStorage.removeItem(LS.ui); }catch{}
  alphaMaps.clear();
  $('#bCards').value = settings.cardSize;
  $('#bCardsV').textContent = settings.cardSize + 'px';
  applyCardSize();
  rebuildAll(); pick(null); paintState();
  toast('Мои правки сброшены, позиции как в файле');
};

}   /* конец кнопок выгрузки */

/* ============================================================
   КЛАВИАТУРА
   ============================================================ */
addEventListener('keydown', e => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();

  if (k === 'b' || k === 'и'){ if (CONFIG.beta) setBeta(!betaOn); return; }
  if (!betaOn){
    if (k === 'r' || k === 'к') randomize();
    else if (k === 'c' || k === 'с') clearAll();
    else if (k === 's' || k === 'ы') screenshot();
    return;
  }

  const step = e.shiftKey ? 10 : 1;
  switch (e.key){
    case 'ArrowLeft':  nudge(-step, 0); e.preventDefault(); break;
    case 'ArrowRight': nudge( step, 0); e.preventDefault(); break;
    case 'ArrowUp':    nudge(0, -step); e.preventDefault(); break;
    case 'ArrowDown':  nudge(0,  step); e.preventDefault(); break;
    case 'Escape':     pick(null); break;
    case 'Tab': {
      const list = onStage();
      const i = picked ? list.findIndex(o => o.cat === picked.cat && o.n === picked.n) : -1;
      pick(list[(i + 1) % list.length]);
      e.preventDefault(); break;
    }
    default:
      if (e.key === '+' || e.key === '=') scaleBy(1.02);
      else if (e.key === '-' || e.key === '_') scaleBy(.98);
      else if (k === 'q' || k === 'й') rotBy(-1);
      else if (k === 'e' || k === 'у') rotBy(1);
      else if (k === 'f' || k === 'а'){ const p = picked && pos(picked.cat, picked.n); if (p){ p.f = (p.f || 1) * -1; commit(); } }
  }
});

/* ============================================================
   ШТОРКА НА МОБИЛКЕ
   ============================================================ */
const sheet = {
  open(){ app.classList.remove('is-sheet-closed'); },
  close(){ app.classList.add('is-sheet-closed'); },
  toggle(){ app.classList.toggle('is-sheet-closed'); sndTap(); }
};
$('#grip').onclick = () => { sheet.toggle(); setTimeout(fitStage, 460); };
$('#fab').onclick  = e => { sheet.open(); sndTap(); sparkleAt(e.clientX, e.clientY); setTimeout(fitStage, 460); };

(() => {
  let y0 = null;
  const g = $('#grip');
  g.addEventListener('pointerdown', e => { y0 = e.clientY; });
  g.addEventListener('pointerup', e => {
    if (y0 == null) return;
    const dy = e.clientY - y0; y0 = null;
    if (dy > 26) sheet.close(); else if (dy < -26) sheet.open();
    setTimeout(fitStage, 460);
  });
})();

/* ============================================================
   ТОСТ
   ============================================================ */
let toastT;
function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('is-on'), 2600);
}

/* ============================================================
   СТАРТ
   ============================================================ */
$('#btnRandom').onclick = randomize;
$('#btnClear').onclick  = clearAll;
$('#btnShot').onclick   = screenshot;
if (CONFIG.beta){
  $('#btnBeta').onclick = () => setBeta(!betaOn);
} else {
  // боевой режим: убираем кнопку и всю панель настройки из страницы
  $('#btnBeta')?.remove();
  $('#beta')?.remove();
}
$('#btnSound').onclick  = () => {
  soundOn = !soundOn;
  writeLS(LS.sound, soundOn);
  $('#soundIcon').textContent = soundOn ? '🔔' : '🔕';
  $('#btnSound').classList.toggle('is-muted', !soundOn);
  $('#btnSound').setAttribute('aria-pressed', String(soundOn));
  if (soundOn) sndTap();
};

baseImg.fetchPriority = 'high';        // тело грузим первым
baseImg.decoding = 'async';
baseImg.src = url(BASE.src);
baseImg.dataset.cat = 'base';
baseImg.dataset.n = 0;
layerEls.set('base/0', baseImg);

$('#soundIcon').textContent = soundOn ? '🔔' : '🔕';
$('#btnSound').classList.toggle('is-muted', !soundOn);
if (CONFIG.beta){
  $('#bCards').value = settings.cardSize;
  $('#bCardsV').textContent = settings.cardSize + 'px';
}
applyCardSize();

buildTabs();
paintShelf(true);
syncFields();
paintState();

worn = normWorn(readLS(LS.outfit, {}));
// первый образ по умолчанию — чтобы не встречать пустотой
if (!Object.keys(worn).length){
  worn = { hair: [1], bangs: [2], top: [2], bottom: [1], socks: [4], shoes: [2] };
  writeLS(LS.outfit, worn);
}
rebuildAll();
fitStage();

if (innerWidth <= 760) sheet.close();

setTimeout(() => { toast('Привет! 🍓 Одевай девочку — кликай по вещам'); berryRain(12); }, 700);

// быстрый доступ из консоли
window.COTTSUG = {
  get layout(){ return layout; },
  get worn(){ return worn; },
  get settings(){ return settings; },
  source: layoutSource,
  wear, randomize, clearAll, berryRain,
  beta: setBeta
};
console.log('%c🍓 COTTSUG · одевашка  ·  t.me/cottsug', 'font:700 16px Nunito;color:#e8629b');
console.log(CONFIG.beta
  ? 'Позиции: COTTSUG.source() · БЕТА-режим: клавиша B'
  : 'Боевой режим: позиции берутся только из js/layout.js');
})();
