/* =====================================================================
   DIDAC · TABLEAU DE CLASSE — outils de classe
   Données du tableau (pages, widgets, classes) : localStorage du navigateur.
   Données sensibles (absences, notes, agenda) : prof.js, chiffrées.
   ===================================================================== */
(function () {
'use strict';

/* ---------- Utilitaires ---------- */
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ICON = (name, v = 'couleur') => (window.DIDAC_ICONS || {})[v + '/' + name] || '';
function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { console.warn('localStorage', e); return false; } }
};
const KEY = 'didac-tableau-v1';

/* ---------- État ---------- */
function defaultState() {
  const de = (navigator.language || '').toLowerCase().startsWith('de');
  return { lang: de ? 'de' : 'fr', pages: [{ id: uid(), name: '', bg: 'blanc', widgets: [] }], current: 0, classes: [], presence: {}, z: 10 };
}
let S = LS.get(KEY, null) || defaultState();
if (!S.pages || !S.pages.length) S = defaultState();
S.classes = S.classes || []; S.presence = S.presence || {};
let saveT = null;
function save(now) {
  clearTimeout(saveT);
  if (now) return LS.set(KEY, S); saveT = setTimeout(() => LS.set(KEY, S), 300); return true;
}
window.addEventListener('beforeunload', () => LS.set(KEY, S));

/* ---------- Langue ---------- */
const T = k => { const d = window.DIDAC_I18N[S.lang] || {}; return d[k] ?? window.DIDAC_I18N.fr[k] ?? k; };
const locale = () => (S.lang === 'de' ? 'de-CH' : 'fr-CH');
function applyStatic() {
  document.documentElement.lang = S.lang;
  document.title = T('appTitle');
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = T(el.dataset.t); });
  document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === S.lang));
  $('#btnClasses').innerHTML = `<span class="ico-on-rot">${ICON('class-lesson', 'blanc')}</span><span class="ico-on-white">${ICON('class-lesson')}</span><span class="lbl">${T('classes')}</span>`;
  $('#btnProf').innerHTML = `<span class="ico-on-rot">${ICON('graduation-cap', 'blanc')}</span><span class="ico-on-white">${ICON('graduation-cap')}</span><span class="lbl">${T('profSpace')}</span>`;
  $('#btnFull').innerHTML = `<span class="lbl">${document.fullscreenElement ? T('exitFull') : T('fullscreen')}</span>`;
  $('#btnFull').title = T('fullscreen');
}

/* ---------- Classes (partagées avec l'espace prof) ---------- */
const classById = id => S.classes.find(c => c.id === id);
function presentStudents(cls) {
  const p = S.presence[cls.id];
  const absent = p && p.date === todayISO() ? p.absent : [];
  return cls.students.filter(s => !absent.includes(s.id));
}
function toggleAbsent(classId, sid) {
  let p = S.presence[classId];
  if (!p || p.date !== todayISO()) p = S.presence[classId] = { date: todayISO(), absent: [] };
  const i = p.absent.indexOf(sid); if (i >= 0) p.absent.splice(i, 1); else p.absent.push(sid);
  save();
}
function isAbsent(classId, sid) { const p = S.presence[classId]; return !!(p && p.date === todayISO() && p.absent.includes(sid)); }
function classSelect(cur) {
  if (!S.classes.length) return `<span class="lbl-s">${T('noClass')}</span> <button class="btn btn--s btn--ghost" data-act="openClasses">${T('createClass')}</button>`;
  return `<select class="inp" data-role="cls" aria-label="${T('class')}">${S.classes.map(c => `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
}
function presenceChips(cls) {
  return `<div class="chips">${cls.students.map(s => `<button class="chip" data-sid="${s.id}" aria-pressed="${!isAbsent(cls.id, s.id)}">${esc(s.name)}</button>`).join('')}</div>`;
}

/* ---------- Son ---------- */
let actx = null;
function beep(times = 3) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + i * 0.45;
      o.type = 'sine'; o.frequency.value = 880; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      o.start(t0); o.stop(t0 + 0.4);
    }
  } catch (e) { /* pas de son */ }
}

/* ---------- Boucle d'horloge commune ---------- */
const tickers = new Set();
setInterval(() => tickers.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }), 200);

/* =====================================================================
   WIDGETS
   Chaque widget : { icon|glyph, w, h, init() → state, mount(body, wd, ctx) → cleanup }
   ===================================================================== */
const fmtHMS = (sec, forceH) => {
  sec = Math.max(0, Math.round(sec));
  const hh = Math.floor(sec / 3600), mm = Math.floor(sec % 3600 / 60), ss = sec % 60;
  return (hh || forceH) ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
};

// Créneaux Didac Bern (LA_Stundenplan SJ 2026/27) : base de l'horaire auto si aucun emploi du temps
const DIDAC_SLOTS = [['08:40', '09:20'], ['09:25', '10:05'], ['10:20', '11:00'], ['11:05', '11:45'], ['11:50', '12:30'], ['12:35', '13:30', 1], ['13:30', '14:10'], ['14:20', '15:00'], ['15:05', '15:45'], ['15:50', '16:30'], ['16:40', '17:20']].map(([s, e, brk]) => ({ s, e, brk: !!brk }));
const WIDGETS = {
  /* ----- Horloge ----- */
  clock: {
    icon: 'alarm-clock', w: 420, h: 300, init: () => ({ sec: true, mode: 'both' }),
    mount(b, wd, ctx) {
      const st = wd.state; st.mode = st.mode || 'digital';
      const ticks = Array.from({ length: 60 }, (_, i) => { const a = i * 6 * Math.PI / 180, big = i % 5 === 0, r1 = big ? 40 : 43; return `<line x1="${50 + r1 * Math.sin(a)}" y1="${50 - r1 * Math.cos(a)}" x2="${50 + 46 * Math.sin(a)}" y2="${50 - 46 * Math.cos(a)}" stroke="${big ? '#000' : '#B2B2B2'}" stroke-width="${big ? 1.6 : .7}"/>`; }).join('');
      const nums = Array.from({ length: 12 }, (_, i) => { const n = i + 1, a = n * 30 * Math.PI / 180; return `<text x="${50 + 33 * Math.sin(a)}" y="${50 - 33 * Math.cos(a) + 3.2}" text-anchor="middle" font-size="9" font-weight="400">${n}</text>`; }).join('');
      b.innerHTML = `<div class="big clock-wrap" data-mode="${st.mode}"><svg class="clock-ana" viewBox="0 0 100 100" role="img" aria-label="${T('w_clock')}">
          <circle cx="50" cy="50" r="47" fill="#fff" stroke="#88004A" stroke-width="2.5"/>${ticks}${nums}
          <line data-h x1="50" y1="50" x2="50" y2="27" stroke="#000" stroke-width="3.2" stroke-linecap="round"/>
          <line data-m x1="50" y1="50" x2="50" y2="15" stroke="#000" stroke-width="2.2" stroke-linecap="round"/>
          <line data-s x1="50" y1="56" x2="50" y2="12" stroke="#88004A" stroke-width="1" stroke-linecap="round"/>
          <circle cx="50" cy="50" r="2.4" fill="#88004A"/></svg>
          <div class="clock-dig"><div class="digits clock-time"></div><div class="clock-date"></div></div></div>
        <div class="ctl"><select class="inp" data-role="mode" aria-label="${T('display')}">${['digital', 'analog', 'both'].map(m => `<option value="${m}" ${st.mode === m ? 'selected' : ''}>${T('clk_' + m)}</option>`).join('')}</select>
          <label class="chk"><input type="checkbox" data-role="sec" ${st.sec ? 'checked' : ''}> ${T('showSeconds')}</label></div>`;
      const tm = $('.clock-time', b), dt = $('.clock-date', b), wrap = $('.clock-wrap', b);
      const hH = $('[data-h]', b), hM = $('[data-m]', b), hS = $('[data-s]', b);
      b.addEventListener('change', e => {
        if (e.target.dataset.role === 'sec') st.sec = e.target.checked;
        if (e.target.dataset.role === 'mode') { st.mode = e.target.value; wrap.dataset.mode = st.mode; }
        save(); upd();
      });
      function upd() {
        const d = new Date();
        const s = d.getSeconds(), m = d.getMinutes() + s / 60, hr = (d.getHours() % 12) + m / 60;
        hH.setAttribute('transform', `rotate(${hr * 30} 50 50)`); hM.setAttribute('transform', `rotate(${m * 6} 50 50)`);
        hS.setAttribute('transform', `rotate(${s * 6} 50 50)`); hS.style.display = st.sec ? '' : 'none';
        tm.textContent = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: wd.state.sec ? '2-digit' : undefined });
        const ds = d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        dt.textContent = ds.charAt(0).toUpperCase() + ds.slice(1);
      }
      upd(); tickers.add(upd); return () => tickers.delete(upd);
    }
  },

  /* ----- Minuteur ----- */
  timer: {
    glyph: '5:00', w: 420, h: 300, compact: true, init: () => ({ dur: 300, remaining: 300, endAt: null, compact: false }),
    mount(b, wd, ctx) {
      const st = wd.state;
      b.innerHTML = `<div class="timer-row"><svg class="timer-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="none" stroke="#DADADA" stroke-width="10"/><circle class="ring" cx="50" cy="50" r="42" fill="none" stroke="#88004A" stroke-width="10" stroke-linecap="round" pathLength="100" stroke-dasharray="100 100" transform="rotate(-90 50 50)"/></svg><div class="big" data-role="main"></div></div>
        <div class="ctl full-only">
          ${[1, 2, 5, 10, 15].map(m => `<button class="btn btn--s btn--ghost" data-m="${m}">${m} min</button>`).join('')}
        </div>
        <div class="ctl full-only" style="padding-top:0">
          <button class="btn btn--ghost" data-act="minus" aria-label="−1 min">−1</button>
          <button class="btn" data-act="go"></button>
          <button class="btn btn--ghost" data-act="reset">${T('reset')}</button>
          <button class="btn btn--ghost" data-act="plus" aria-label="+1 min">+1</button>
        </div>`;
      const main = $('[data-role=main]', b), ring = $('.ring', b), go = $('[data-act=go]', b);
      let editing = false, rang = false;
      const left = () => st.endAt ? Math.max(0, (st.endAt - Date.now()) / 1000) : st.remaining;
      function renderMain() {
        if (editing) return;
        const l = left();
        if (st.endAt === null && st.remaining <= 0 && st.dur > 0) {
          main.innerHTML = `<div><div class="digits timer-disp">00:00</div><div class="done-msg">${T('timeUp')}</div></div>`;
          if (st.compact) main.firstElementChild.onclick = () => setDur(st.dur);
        } else {
          main.innerHTML = `<button class="digits timer-disp" style="border:0;background:transparent" title="${st.compact ? T('clickToStart') : T('clickToEdit')}">${fmtHMS(Math.ceil(l))}</button>`;
          $('.timer-disp', main).onclick = st.compact ? toggle : edit;
        }
      }
      function upd() {
        const l = left();
        if (st.endAt && l <= 0) { st.endAt = null; st.remaining = 0; save(); ctx.el.classList.add('is-done'); if (!rang) { rang = true; beep(); } renderMain(); }
        if (!editing) { const d = $('.timer-disp', main); if (d && st.endAt) d.textContent = fmtHMS(Math.ceil(l)); }
        ring.setAttribute('stroke-dasharray', `${st.dur ? Math.min(100, l / st.dur * 100) : 0} 100`);
        go.textContent = st.endAt ? T('pause') : T('start');
      }
      function toggle() {
        editing = false;
        if (st.endAt) { st.remaining = left(); st.endAt = null; }
        else { if (st.remaining <= 0) { st.remaining = st.dur; ctx.el.classList.remove('is-done'); rang = false; } if (st.remaining > 0) st.endAt = Date.now() + st.remaining * 1000; }
        save(); renderMain(); upd();
      }
      function setDur(sec) { st.dur = Math.max(0, sec); st.remaining = st.dur; st.endAt = null; rang = false; ctx.el.classList.remove('is-done'); save(); renderMain(); upd(); }
      function edit() {
        if (st.endAt) return;
        editing = true;
        const l = Math.round(st.remaining || st.dur);
        main.innerHTML = `<form class="timer-edit"><input class="inp" type="number" min="0" max="599" value="${Math.floor(l / 60)}" aria-label="min"> : <input class="inp" type="number" min="0" max="59" value="${l % 60}" aria-label="s"> <button class="btn">OK</button></form>`;
        const f = $('form', main); $('input', f).select();
        f.onsubmit = e => { e.preventDefault(); const [m, s] = [...f.querySelectorAll('input')].map(i => parseInt(i.value || 0, 10)); editing = false; setDur(m * 60 + s); };
      }
      b.addEventListener('click', e => {
        const m = e.target.closest('[data-m]'); if (m) { editing = false; setDur(+m.dataset.m * 60); return; }
        const a = e.target.closest('[data-act]'); if (!a) return;
        if (a.dataset.act === 'go') toggle();
        if (a.dataset.act === 'reset') { editing = false; setDur(st.dur); }
        if (a.dataset.act === 'plus' || a.dataset.act === 'minus') {
          const d = a.dataset.act === 'plus' ? 60 : -60;
          if (st.endAt) { st.endAt = Math.max(Date.now(), st.endAt + d * 1000); st.dur = Math.max(st.dur, left()); }
          else { setDur(Math.max(0, (st.remaining > 0 ? st.remaining : st.dur) + d)); return; }
          save(); upd();
        }
      });
      if (st.endAt === null && st.remaining <= 0 && st.dur > 0) ctx.el.classList.add('is-done');
      renderMain(); upd(); tickers.add(upd); return () => tickers.delete(upd);
    }
  },

  /* ----- Horaire auto : enchaînement cours → pause → cours, calé sur l'heure ----- */
  schedule: {
    icon: 'arrow-roadmap', w: 460, h: 380, compact: true, init: () => ({ mode: 'mine', sound: true, compact: false }),
    mount(b, wd, ctx) {
      const st = wd.state; let lastKey = null;
      const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
      const fmtT = sec => fmtHMS(Math.max(0, Math.ceil(sec)), sec >= 3600);
      function segments(now) {
        const sched = S.schedule || { slots: DIDAC_SLOTS, cells: {} };
        const day = now.getDay(); if (day < 1 || day > 5) return [];
        const hasMine = Object.keys(sched.cells || {}).some(k => k.startsWith(day + '-'));
        const mode = st.mode === 'mine' && Object.keys(sched.cells || {}).length ? 'mine' : 'all';
        if (mode === 'mine' && !hasMine) return [];
        const L = sched.slots.map((sl, i) => ({ sl, i })).filter(({ sl, i }) => !sl.brk && (mode === 'all' || sched.cells[day + '-' + i]))
          .map(({ sl, i }) => { const c = (sched.cells || {})[day + '-' + i]; return { type: 'lesson', s: toMin(sl.s), e: toMin(sl.e), label: c ? [c.subject, c.cls].filter(Boolean).join(' · ') || T('lesson') : T('lesson'), room: c && c.room, color: c && c.color }; });
        const out = [];
        L.forEach((seg, k) => {
          out.push(seg); const nx = L[k + 1];
          if (nx && nx.s > seg.e) {
            const lunch = sched.slots.some(sl => sl.brk && toMin(sl.s) < nx.s && toMin(sl.e) > seg.e);
            out.push({ type: 'pause', s: seg.e, e: nx.s, label: lunch ? T('lunch') : T('pauseLbl') });
          }
        });
        return out;
      }
      const hhmm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
      function upd() {
        const now = new Date(); const nowM = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
        const segs = segments(now);
        let cur = segs.findIndex(sg => nowM >= sg.s && nowM < sg.e), state;
        if (!segs.length) state = 'none'; else if (cur >= 0) state = 'run'; else if (nowM < segs[0].s) state = 'before'; else state = 'after';
        const seg = cur >= 0 ? segs[cur] : null, next = state === 'before' ? segs[0] : (cur >= 0 ? segs[cur + 1] : null);
        const key = state + ':' + cur;
        if (lastKey !== null && key !== lastKey && st.sound && (state === 'run' || state === 'after')) beep(seg && seg.type === 'pause' ? 2 : 3);
        const changed = key !== lastKey; lastKey = key;
        ctx.el.classList.toggle('is-pause', !!(seg && seg.type === 'pause') || state === 'before');
        const left = seg ? (seg.e - nowM) * 60 : state === 'before' ? (segs[0].s - nowM) * 60 : 0;
        const pct = seg ? Math.min(100, (seg.e - nowM) / (seg.e - seg.s) * 100) : 0;
        if (changed || !$('.sch-main', b)) {
          const title = state === 'none' ? T('noLessonToday') : state === 'after' ? T('dayOver') : state === 'before' ? T('beforeFirst') : seg.label;
          b.innerHTML = `<div class="timer-row"><svg class="timer-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="none" stroke="#DADADA" stroke-width="10"/><circle class="ring" cx="50" cy="50" r="42" fill="none" stroke="#88004A" stroke-width="10" stroke-linecap="round" pathLength="100" stroke-dasharray="0 100" transform="rotate(-90 50 50)"/></svg>
            <div class="big sch-main"><div><div class="sch-kind">${seg ? (seg.type === 'pause' ? T('pauseLbl') : T('lesson')) + ` · ${hhmm(seg.s)}–${hhmm(seg.e)}` : ''}</div><div class="sch-title">${esc(title)}</div>
              ${state === 'run' || state === 'before' ? `<div class="digits sch-left"></div>` : ''}
              ${next ? `<div class="sch-next">${T('nextUp')} ${esc(next.type === 'pause' ? next.label : next.label)} · ${hhmm(next.s)}${next.room ? ' · ' + T('room') + ' ' + esc(next.room) : ''}</div>` : ''}</div></div></div>
            <ol class="sch-list full-only">${segs.map((sg, k) => `<li class="${k === cur ? 'is-cur' : ''} ${sg.type === 'pause' ? 'is-p' : ''} ${sg.e <= nowM ? 'is-past' : ''}"><span>${hhmm(sg.s)}–${hhmm(sg.e)}</span><span>${esc(sg.label)}</span></li>`).join('')}</ol>
            <div class="ctl full-only"><select class="inp" data-role="mode" aria-label="${T('display')}"><option value="mine" ${st.mode === 'mine' ? 'selected' : ''}>${T('schMine')}</option><option value="all" ${st.mode === 'all' ? 'selected' : ''}>${T('schAll')}</option></select>
              <label class="chk"><input type="checkbox" data-role="sound" ${st.sound ? 'checked' : ''}> ${T('sound')}</label></div>
            ${st.mode === 'mine' && !Object.keys((S.schedule || {}).cells || {}).length ? `<div class="hint full-only">${T('schHint')}</div>` : ''}`;
        }
        const lf = $('.sch-left', b); if (lf) lf.textContent = fmtT(left);
        const ring = $('.ring', b); if (ring) ring.setAttribute('stroke-dasharray', `${pct} 100`);
      }
      b.addEventListener('change', e => {
        if (e.target.dataset.role === 'mode') { st.mode = e.target.value; lastKey = null; save(); b.innerHTML = ''; upd(); }
        if (e.target.dataset.role === 'sound') { st.sound = e.target.checked; save(); }
      });
      const onSched = () => { b.innerHTML = ''; lastKey = null; upd(); };
      window.addEventListener('didac-schedule', onSched);
      upd(); tickers.add(upd);
      return () => { tickers.delete(upd); window.removeEventListener('didac-schedule', onSched); };
    }
  },

  /* ----- Chronomètre ----- */
  stopwatch: {
    glyph: '0:00', w: 400, h: 280, init: () => ({ start: null, acc: 0, laps: [] }),
    mount(b, wd) {
      const st = wd.state;
      b.innerHTML = `<div class="big"><div class="digits sw-disp"></div></div><ol class="sw-laps"></ol>
        <div class="ctl"><button class="btn" data-act="go"></button><button class="btn btn--ghost" data-act="lap">${T('lap')}</button><button class="btn btn--ghost" data-act="reset">${T('reset')}</button></div>`;
      const disp = $('.sw-disp', b), laps = $('.sw-laps', b), go = $('[data-act=go]', b);
      const el = () => st.acc + (st.start ? Date.now() - st.start : 0);
      const fmt = ms => { const t = Math.floor(ms / 100); const ds = t % 10, s = Math.floor(t / 10); return fmtHMS(s) + '.' + ds; };
      function renderLaps() { laps.innerHTML = st.laps.map((l, i) => `<li><span>${T('lap')} ${i + 1}</span><span>${fmt(l)}</span></li>`).reverse().join(''); }
      function upd() { disp.textContent = fmt(el()); go.textContent = st.start ? T('pause') : T('start'); }
      b.addEventListener('click', e => {
        const a = e.target.closest('[data-act]'); if (!a) return;
        if (a.dataset.act === 'go') { if (st.start) { st.acc = el(); st.start = null; } else st.start = Date.now(); }
        if (a.dataset.act === 'lap' && el() > 0) { st.laps.push(el()); renderLaps(); }
        if (a.dataset.act === 'reset') { st.start = null; st.acc = 0; st.laps = []; renderLaps(); }
        save(); upd();
      });
      renderLaps(); upd(); tickers.add(upd); return () => tickers.delete(upd);
    }
  },

  /* ----- Nom au hasard ----- */
  random: {
    icon: 'user-single-neutral-male', w: 460, h: 320, init: () => ({ classId: null, noRepeat: true, drawn: [], last: null, view: 'draw' }),
    mount(b, wd) {
      const st = wd.state;
      if (!classById(st.classId) && S.classes[0]) st.classId = S.classes[0].id;
      let spinning = null;
      function render() {
        const cls = classById(st.classId);
        if (!cls) { b.innerHTML = `<div class="big"><div><p>${T('noClassHint')}</p><button class="btn" data-act="openClasses">${T('createClass')}</button></div></div>`; return; }
        const pool = presentStudents(cls).filter(s => !st.noRepeat || !st.drawn.includes(s.id));
        const lastS = cls.students.find(s => s.id === st.last);
        b.innerHTML = `<div class="ctl">${classSelect(st.classId)}
            <label class="chk"><input type="checkbox" data-role="norep" ${st.noRepeat ? 'checked' : ''}> ${T('noRepeat')}</label>
            <button class="btn btn--s btn--ghost" data-act="view">${st.view === 'draw' ? T('presence') : T('back')}</button></div>
          ${st.view === 'draw' ? `<div class="big"><div><div class="rn-name">${lastS ? esc(lastS.name) : '?'}</div>
            <div class="rn-count">${st.noRepeat ? T('remaining').replace('{n}', pool.length) : T('presentCount').replace('{n}', presentStudents(cls).length)}</div></div></div>
          <div class="ctl"><button class="btn" data-act="draw" ${pool.length || st.noRepeat ? '' : 'disabled'}>${pool.length || !st.noRepeat ? T('draw') : T('restart')}</button>
            ${st.noRepeat ? `<button class="btn btn--ghost" data-act="restart">${T('restart')}</button>` : ''}</div>`
          : `<div class="hint" style="padding-top:4px">${T('presenceHint')}</div><div class="panel-sub">${presenceChips(cls)}</div>`}`;
      }
      b.addEventListener('change', e => {
        if (e.target.dataset.role === 'cls') { st.classId = e.target.value; st.drawn = []; st.last = null; save(); render(); }
        if (e.target.dataset.role === 'norep') { st.noRepeat = e.target.checked; st.drawn = []; save(); render(); }
      });
      b.addEventListener('click', e => {
        const chip = e.target.closest('.chip'); if (chip) { toggleAbsent(st.classId, chip.dataset.sid); chip.setAttribute('aria-pressed', !isAbsent(st.classId, chip.dataset.sid)); return; }
        const a = e.target.closest('[data-act]'); if (!a || spinning) return;
        const cls = classById(st.classId);
        if (a.dataset.act === 'view') { st.view = st.view === 'draw' ? 'presence' : 'draw'; save(); render(); }
        if (a.dataset.act === 'restart') { st.drawn = []; st.last = null; save(); render(); }
        if (a.dataset.act === 'draw' && cls) {
          let pool = presentStudents(cls).filter(s => !st.noRepeat || !st.drawn.includes(s.id));
          if (!pool.length) { st.drawn = []; save(); render(); return; }
          const pick = pool[Math.floor(Math.random() * pool.length)];
          const nameEl = $('.rn-name', b); nameEl.classList.add('is-spin');
          const all = presentStudents(cls); let n = 0;
          spinning = setInterval(() => {
            nameEl.textContent = all[Math.floor(Math.random() * all.length)].name;
            if (++n > 14) { clearInterval(spinning); spinning = null; st.last = pick.id; if (st.noRepeat) st.drawn.push(pick.id); save(); render(); }
          }, 70);
        }
      });
      render();
      return () => { if (spinning) clearInterval(spinning); };
    }
  },

  /* ----- Groupes (avec glisser-déposer des noms) ----- */
  groups: {
    icon: 'user-multiple-group', w: 620, h: 400, init: () => ({ classId: null, mode: 'count', n: 4, groups: [], view: 'groups' }),
    mount(b, wd) {
      const st = wd.state;
      if (!classById(st.classId) && S.classes[0]) st.classId = S.classes[0].id;
      function render() {
        const cls = classById(st.classId);
        if (!cls) { b.innerHTML = `<div class="big"><div><p>${T('noClassHint')}</p><button class="btn" data-act="openClasses">${T('createClass')}</button></div></div>`; return; }
        const names = id => (cls.students.find(s => s.id === id) || {}).name;
        b.innerHTML = `<div class="ctl">${classSelect(st.classId)}
            <select class="inp" data-role="mode"><option value="count" ${st.mode === 'count' ? 'selected' : ''}>${T('nbGroups')}</option><option value="size" ${st.mode === 'size' ? 'selected' : ''}>${T('perGroup')}</option></select>
            <input class="inp" type="number" min="1" max="40" value="${st.n}" data-role="n" style="width:4.5em" aria-label="n">
            <button class="btn" data-act="make">${T('makeGroups')}</button>
            <button class="btn btn--s btn--ghost" data-act="view">${st.view === 'groups' ? T('presence') : T('back')}</button></div>
          ${st.view === 'groups' ? (st.groups.length ? `<div class="hint" style="padding:0 10px">${T('dragHint')}</div><div class="grp-grid">${st.groups.map((g, i) => `<div class="grp" data-g="${i}"><h4>${T('group')} ${i + 1}</h4><ul>${g.filter(id => names(id)).map(id => `<li class="gname" data-id="${id}">${esc(names(id))}</li>`).join('')}</ul></div>`).join('')}</div>`
            : `<div class="big"><p class="lbl-s">${T('groupsHint')}</p></div>`)
          : `<div class="hint" style="padding-top:4px">${T('presenceHint')}</div><div class="panel-sub">${presenceChips(cls)}</div>`}`;
      }
      b.addEventListener('change', e => {
        const r = e.target.dataset.role;
        if (r === 'cls') { st.classId = e.target.value; st.groups = []; save(); render(); }
        if (r === 'mode') { st.mode = e.target.value; save(); }
        if (r === 'n') { st.n = Math.max(1, Math.min(40, parseInt(e.target.value, 10) || 1)); save(); }
      });
      b.addEventListener('click', e => {
        const chip = e.target.closest('.chip'); if (chip) { toggleAbsent(st.classId, chip.dataset.sid); chip.setAttribute('aria-pressed', !isAbsent(st.classId, chip.dataset.sid)); return; }
        const a = e.target.closest('[data-act]'); if (!a) return;
        if (a.dataset.act === 'view') { st.view = st.view === 'groups' ? 'presence' : 'groups'; save(); render(); }
        if (a.dataset.act === 'make') {
          const cls = classById(st.classId); if (!cls) return;
          const nInput = $('[data-role=n]', b); if (nInput) st.n = Math.max(1, parseInt(nInput.value, 10) || 1);
          const list = shuffle(presentStudents(cls).map(s => s.id));
          const k = st.mode === 'count' ? Math.min(st.n, list.length) : Math.max(1, Math.round(list.length / st.n));
          const g = Array.from({ length: Math.max(1, k) }, () => []);
          list.forEach((id, i) => g[i % g.length].push(id));
          st.groups = g; st.view = 'groups'; save(); render();
        }
      });
      // Glisser un nom vers un autre groupe (souris, stylet, écran tactile)
      b.addEventListener('pointerdown', e => {
        const li = e.target.closest('.gname'); if (!li || e.button > 0) return;
        e.preventDefault(); e.stopPropagation();
        const id = li.dataset.id, from = +li.closest('.grp').dataset.g;
        const ghost = li.cloneNode(true); ghost.classList.add('gghost'); document.body.appendChild(ghost);
        const place = ev => { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; };
        place(e); li.classList.add('is-drag');
        let over = null;
        const mv = ev => {
          place(ev);
          const t = document.elementFromPoint(ev.clientX, ev.clientY); const g = t && t.closest('.grp');
          const ok = g && b.contains(g) ? g : null;
          if (over && over !== ok) over.classList.remove('is-over');
          over = ok; if (over) over.classList.add('is-over');
        };
        const up = () => {
          document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
          ghost.remove(); li.classList.remove('is-drag');
          if (over) { const to = +over.dataset.g; if (to !== from) { st.groups[from] = st.groups[from].filter(x => x !== id); st.groups[to].push(id); save(); } }
          render();
        };
        document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
      });
      render();
    }
  },

  /* ----- Dés : d4, d6, d8, d10, d12, d20, pièce ----- */
  dice: {
    icon: 'dices-entertainment-gaming-dices', w: 420, h: 320, init: () => ({ kind: 'd6', count: 1, values: [6] }),
    mount(b, wd) {
      const st = wd.state; st.kind = st.kind || 'd6';
      const KINDS = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, coin: 2 };
      const SHAPES = { d4: '50,6 95,90 5,90', d8: '50,3 95,50 50,97 5,50', d10: '50,3 95,42 50,97 5,42', d12: '50,3 96,36 79,92 21,92 4,36', d20: '50,2 93,26 93,74 50,98 7,74 7,26' };
      const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
      const face = v => {
        if (st.kind === 'd6') return `<div class="die" role="img" aria-label="${v}">${Array.from({ length: 9 }, (_, i) => PIPS[v].includes(i + 1) ? '<i></i>' : '<span></span>').join('')}</div>`;
        if (st.kind === 'coin') { const l = v === 1 ? T('heads') : T('tails'); return `<div class="die die--coin" role="img" aria-label="${l}"><span>${l}</span></div>`; }
        const ty = st.kind === 'd4' ? 70 : 58;
        return `<svg class="die die--poly" viewBox="0 0 100 100" role="img" aria-label="${v}"><polygon points="${SHAPES[st.kind]}" fill="#fff" stroke="#000" stroke-width="4" stroke-linejoin="round"/><text x="50" y="${ty}" text-anchor="middle" font-size="${v > 9 ? 30 : 36}" font-weight="700" fill="#88004A">${v}</text></svg>`;
      };
      const roll = () => Array.from({ length: st.count }, () => 1 + Math.floor(Math.random() * KINDS[st.kind]));
      function render(anim) {
        const sum = st.values.reduce((a, c) => a + c, 0);
        b.innerHTML = `<div class="big"><div><div class="dice-row">${st.values.map(face).join('')}</div>${st.count > 1 && st.kind !== 'coin' ? `<div class="dice-sum">${T('total')} : ${sum}</div>` : ''}</div></div>
          <div class="ctl"><select class="inp" data-role="kind" aria-label="${T('diceType')}">${Object.keys(KINDS).map(k => `<option value="${k}" ${k === st.kind ? 'selected' : ''}>${k === 'coin' ? T('coin') : k.toUpperCase().replace('D', T('dieShort'))}</option>`).join('')}</select>
          <select class="inp" data-role="count" aria-label="${T('dice')}">${[1, 2, 3, 4, 5, 6].map(n => `<option ${n === st.count ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <button class="btn" data-act="roll">${st.kind === 'coin' ? T('flip') : T('roll')}</button></div>`;
        if (anim) b.querySelectorAll('.die').forEach(d => d.classList.add('is-roll'));
      }
      b.addEventListener('change', e => {
        if (e.target.dataset.role === 'count') st.count = +e.target.value;
        if (e.target.dataset.role === 'kind') st.kind = e.target.value;
        st.values = roll(); save(); render(true);
      });
      b.addEventListener('click', e => { if (e.target.closest('[data-act=roll]')) { st.values = roll(); save(); render(true); } });
      if (st.values.some(v => v > KINDS[st.kind])) st.values = roll();
      render();
    }
  },

  /* ----- Compte à rebours (manuel ou évènement de l'espace prof) ----- */
  countdown: {
    icon: 'blank-calendar', w: 520, h: 280, init: () => ({ title: '', target: '', daysOnly: false, eventId: null }),
    mount(b, wd) {
      const st = wd.state; let editing = !st.target && !st.eventId;
      const evOf = () => st.eventId ? (S.events || []).find(e => e.id === st.eventId) : null;
      const cur = () => { const e = evOf(); return e ? { title: e.title, target: e.date } : { title: st.title, target: st.target }; };
      function render() {
        if (editing) {
          const evs = (S.events || []).slice().sort((a, c) => a.date.localeCompare(c.date));
          b.innerHTML = `<div class="big"><form class="cd-form">
            ${evs.length ? `<label class="field"><span>${T('fromAgenda')}</span><select class="inp" name="ev"><option value="">${T('manualEvent')}</option>${evs.map(e => `<option value="${e.id}" ${e.id === st.eventId ? 'selected' : ''}>${esc(e.title)} · ${new Date(e.date).toLocaleDateString(locale())}</option>`).join('')}</select></label>` : `<p class="lbl-s" style="margin:0">${T('eventsTip')}</p>`}
            <div data-role="manual" class="cd-form" style="padding:0">
            <label class="field"><span>${T('eventName')}</span><input class="inp" name="t" value="${esc(st.title)}" placeholder="${T('eventPh')}"></label>
            <label class="field"><span>${T('eventDate')}</span><input class="inp" type="datetime-local" name="d" value="${esc(st.target)}"></label></div>
            <label class="chk"><input type="checkbox" name="o" ${st.daysOnly ? 'checked' : ''}> ${T('daysOnly')}</label>
            <div class="row"><button class="btn">OK</button></div></form></div>`;
          const f = $('form', b), man = $('[data-role=manual]', b);
          const sync = () => { man.hidden = !!(f.ev && f.ev.value); };
          if (f.ev) f.ev.onchange = sync; sync();
          f.onsubmit = e => {
            e.preventDefault();
            st.eventId = f.ev && f.ev.value ? f.ev.value : null;
            if (!st.eventId) { if (!f.d.value) { f.d.focus(); return; } st.title = f.t.value.trim(); st.target = f.d.value; }
            st.daysOnly = f.o.checked; editing = false; save(); render();
          };
          return;
        }
        const c = cur();
        b.innerHTML = `<div class="big"><div><div class="cd-title">${esc(c.title || T('countdown'))}</div><div class="cd-units"></div><div class="lbl-s" data-role="when" style="margin-top:.4em"></div></div></div>
          <div class="ctl"><button class="btn btn--s btn--ghost" data-act="edit">${T('edit')}</button></div>`;
        $('[data-act=edit]', b).onclick = () => { editing = true; render(); };
        upd();
      }
      function upd() {
        if (editing) return;
        const box = $('.cd-units', b); if (!box) return;
        const c = cur(); if (!c.target) { box.innerHTML = `<p class="lbl-s">${T('eventGone')}</p>`; return; }
        const t = new Date(c.target).getTime(); let s = Math.floor((t - Date.now()) / 1000);
        $('[data-role=when]', b).textContent = new Date(c.target).toLocaleString(locale(), { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
        if (!(s > 0)) { box.innerHTML = `<div class="done-msg">${T('eventNow')}</div>`; return; }
        if (st.daysOnly) { const dd = Math.ceil(s / 86400); box.innerHTML = `<div class="cd-unit"><b>${dd}</b><span>${dd > 1 ? T('days') : T('day')}</span></div>`; return; }
        const u = [[Math.floor(s / 86400), T('days')], [Math.floor(s % 86400 / 3600), T('hours')], [Math.floor(s % 3600 / 60), T('minutes')], [s % 60, T('seconds')]];
        box.innerHTML = u.map(([v, l]) => `<div class="cd-unit"><b>${l === T('days') ? v : pad(v)}</b><span>${l}</span></div>`).join('');
      }
      const onEv = () => { if (!editing) render(); };
      window.addEventListener('didac-events', onEv);
      render(); tickers.add(upd); return () => { tickers.delete(upd); window.removeEventListener('didac-events', onEv); };
    }
  },

  /* ----- Texte (export PDF) ----- */
  text: {
    icon: 'pencil', w: 560, h: 380, init: () => ({ html: '', size: 26 }),
    mount(b, wd) {
      const st = wd.state;
      b.innerHTML = `<div class="tx-tools">
          <button class="tb" data-cmd="bold" title="${T('bold')}"><b>B</b></button>
          <button class="tb" data-cmd="italic" title="${T('italic')}"><i>I</i></button>
          <button class="tb" data-cmd="underline" title="${T('underline')}"><u>U</u></button>
          <button class="tb" data-cmd="insertUnorderedList" title="${T('list')}">• ≡</button>
          <button class="tb" data-cmd="insertOrderedList" title="${T('numList')}">1. ≡</button>
          <button class="tb" data-cmd="hl" title="${T('highlight')}"><span class="hl" style="background:var(--d-gelb);padding:0 4px">ab</span></button>
          <button class="tb" data-size="-" title="${T('smaller')}">A−</button>
          <button class="tb" data-size="+" title="${T('bigger')}">A+</button>
          <span class="sp"></span>
          <button class="btn btn--s" data-act="pdf">PDF</button>
        </div>
        <div class="tx-area" contenteditable="true" spellcheck="true" data-ph="${T('textPh')}"></div>`;
      const area = $('.tx-area', b);
      area.innerHTML = st.html; area.style.fontSize = st.size + 'px';
      const store = () => { st.html = area.innerHTML; save(); };
      area.addEventListener('input', store);
      area.addEventListener('paste', e => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); });
      b.addEventListener('mousedown', e => { if (e.target.closest('.tb')) e.preventDefault(); });
      b.addEventListener('click', e => {
        const c = e.target.closest('[data-cmd]');
        if (c) {
          area.focus();
          if (c.dataset.cmd === 'hl') {
            const sel = window.getSelection();
            if (sel.rangeCount && !sel.isCollapsed && area.contains(sel.anchorNode)) {
              const r = sel.getRangeAt(0); const anc = sel.anchorNode.parentElement && sel.anchorNode.parentElement.closest('.hl');
              if (anc) { anc.replaceWith(...anc.childNodes); }
              else { const span = document.createElement('span'); span.className = 'hl'; try { r.surroundContents(span); } catch (err) { span.appendChild(r.extractContents()); r.insertNode(span); } }
            }
          } else document.execCommand(c.dataset.cmd, false, null);
          store(); return;
        }
        const sz = e.target.closest('[data-size]');
        if (sz) { st.size = Math.max(14, Math.min(96, st.size + (sz.dataset.size === '+' ? 4 : -4))); area.style.fontSize = st.size + 'px'; save(); return; }
        if (e.target.closest('[data-act=pdf]')) exportPDF(area.innerHTML);
      });
    }
  },

  /* ----- Calculatrice ----- */
  calc: {
    glyph: '+−×÷', w: 340, h: 440, init: () => ({ expr: '', res: '' }),
    mount(b, wd) {
      const st = wd.state;
      const KEYS = [['C', 'fn'], ['(', 'fn'], [')', 'fn'], ['÷', 'op'], ['7'], ['8'], ['9'], ['×', 'op'], ['4'], ['5'], ['6'], ['−', 'op'], ['1'], ['2'], ['3'], ['+', 'op'], ['⌫', 'fn'], ['0'], ['.'], ['=', 'eq']];
      b.innerHTML = `<div class="calc" tabindex="0"><div class="calc-screen"><div class="calc-expr"></div><div class="calc-res"></div></div>
        <div class="calc-keys">${KEYS.map(([k, t]) => `<button class="ck ${t === 'op' ? 'ck--op' : ''} ${t === 'eq' ? 'ck--eq' : ''}" data-k="${k}">${k}</button>`).join('')}</div></div>`;
      const ex = $('.calc-expr', b), rs = $('.calc-res', b);
      const show = () => { ex.textContent = st.expr || ' '; rs.textContent = st.res !== '' ? st.res : (st.expr ? '' : '0'); };
      function press(k) {
        if (k === 'C') { st.expr = ''; st.res = ''; }
        else if (k === '⌫') st.expr = st.expr.slice(0, -1);
        else if (k === '=') {
          try { const v = evalExpr(st.expr); st.res = fmtNum(v); }
          catch (e) { st.res = T('error'); }
        } else {
          if (st.res !== '' && st.res !== T('error') && /[+−×÷]/.test(k)) st.expr = st.res.replace(/’/g, '').replace(',', '.') + k;
          else if (st.res !== '' && /[0-9.(]/.test(k)) st.expr = k;
          else st.expr += k;
          st.res = '';
        }
        save(); show();
      }
      b.addEventListener('click', e => { const k = e.target.closest('[data-k]'); if (k) press(k.dataset.k); });
      $('.calc', b).addEventListener('keydown', e => {
        const map = { '*': '×', '/': '÷', '-': '−', '+': '+', 'Enter': '=', '=': '=', 'Backspace': '⌫', 'Escape': 'C', ',': '.' };
        const k = map[e.key] || (/^[0-9.()]$/.test(e.key) ? e.key : null);
        if (k) { e.preventDefault(); press(k); }
      });
      show();
    }
  },

  /* ----- Dessin (crayon + formes toutes faites) ----- */
  draw: {
    icon: 'paint-palette', w: 680, h: 460, init: () => ({ img: '', color: '#000000', size: 6, tool: 'pen', fill: false }),
    mount(b, wd) {
      const st = wd.state; st.tool = st.tool || 'pen';
      const COLORS = ['#000000', '#88004A', '#575757', '#29B8D8', '#8CC63F', '#F5C300', '#F07D00', '#E8507A'];
      const TOOLS = [['pen', '✎'], ['line', '╱'], ['arrow', '➜'], ['rect', '▭'], ['ellipse', '◯'], ['triangle', '△'], ['star', '☆']];
      b.innerHTML = `<div class="dr-tools">
          <div class="dr-shapes" role="group" aria-label="${T('shapes')}">${TOOLS.map(([k, g]) => `<button class="tb" data-tool="${k}" aria-pressed="${st.tool === k}" title="${T('sh_' + k)}" aria-label="${T('sh_' + k)}">${g}</button>`).join('')}</div>
          <label class="chk" title="${T('fillShape')}"><input type="checkbox" data-role="fill" ${st.fill ? 'checked' : ''}> ${T('fill')}</label>
          <span class="dock-sep" style="margin:2px"></span>
          ${COLORS.map(c => `<button class="sw" style="background:${c}" data-c="${c}" aria-label="${c}" aria-pressed="${st.color === c}"></button>`).join('')}
          <button class="tb" data-c="eraser" aria-pressed="${st.color === 'eraser'}">${T('eraser')}</button>
          <select class="inp" data-role="size" aria-label="${T('thickness')}">${[3, 6, 12, 24].map(s => `<option value="${s}" ${s === st.size ? 'selected' : ''}>${s} px</option>`).join('')}</select>
          <span class="sp" style="flex:1"></span>
          <button class="btn btn--s btn--ghost" data-act="undo" title="${T('undo')}">↶</button>
          <button class="btn btn--s btn--ghost" data-act="clear">${T('clear')}</button>
          <button class="btn btn--s" data-act="png">PNG</button>
        </div><div class="dr-canvas"><canvas></canvas></div>`;
      const wrap = $('.dr-canvas', b), cv = $('canvas', b), g = cv.getContext('2d');
      let drawing = false, last = null, start = null, snap = null, saveTimer = null; const hist = [];
      function loadImg() { if (!st.img) return; const im = new Image(); im.onload = () => g.drawImage(im, 0, 0, im.width, im.height); im.src = st.img; }
      function fit() {
        const r = wrap.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
        const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
        if (cv.width === W && cv.height === H) return;
        const old = cv.width > 1 ? cv.toDataURL() : null;
        cv.width = W; cv.height = H; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
        if (old) { const im = new Image(); im.onload = () => g.drawImage(im, 0, 0); im.src = old; } else loadImg();
      }
      const ro = new ResizeObserver(fit); ro.observe(wrap);
      const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
      const pen = () => { const dpr = window.devicePixelRatio || 1; const col = st.color === 'eraser' ? '#fff' : st.color; g.strokeStyle = col; g.fillStyle = col; g.lineWidth = (st.color === 'eraser' ? st.size * 3 : st.size) * dpr; g.lineCap = 'round'; g.lineJoin = 'round'; };
      cv.addEventListener('pointerdown', e => {
        drawing = true; cv.setPointerCapture(e.pointerId); last = start = pos(e);
        hist.push(g.getImageData(0, 0, cv.width, cv.height)); if (hist.length > 15) hist.shift();
        if (st.tool === 'pen' || st.color === 'eraser') stroke(last, last); else snap = hist[hist.length - 1];
      });
      cv.addEventListener('pointermove', e => {
        if (!drawing) return; const p = pos(e);
        if (st.tool === 'pen' || st.color === 'eraser') { stroke(last, p); last = p; }
        else { g.putImageData(snap, 0, 0); shape(start, p, e.shiftKey); }
      });
      const end = () => { if (!drawing) return; drawing = false; snap = null; clearTimeout(saveTimer); saveTimer = setTimeout(() => { st.img = cv.toDataURL('image/png'); save(); }, 400); };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      function stroke(a, c) { pen(); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); }
      function shape(a, c, square) {
        pen();
        let [x0, y0] = a, [x1, y1] = c;
        if (square && st.tool !== 'line' && st.tool !== 'arrow') { const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * d; y1 = y0 + Math.sign(y1 - y0 || 1) * d; }
        const fill = st.fill && !['line', 'arrow'].includes(st.tool);
        g.beginPath();
        if (st.tool === 'line') { g.moveTo(x0, y0); g.lineTo(x1, y1); }
        if (st.tool === 'arrow') {
          g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.beginPath();
          const ang = Math.atan2(y1 - y0, x1 - x0), hl = Math.max(14, g.lineWidth * 4);
          g.moveTo(x1, y1); g.lineTo(x1 - hl * Math.cos(ang - 0.45), y1 - hl * Math.sin(ang - 0.45)); g.lineTo(x1 - hl * Math.cos(ang + 0.45), y1 - hl * Math.sin(ang + 0.45)); g.closePath(); g.fill();
          return;
        }
        if (st.tool === 'rect') g.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        if (st.tool === 'ellipse') g.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
        if (st.tool === 'triangle') { g.moveTo((x0 + x1) / 2, Math.min(y0, y1)); g.lineTo(Math.max(x0, x1), Math.max(y0, y1)); g.lineTo(Math.min(x0, x1), Math.max(y0, y1)); g.closePath(); }
        if (st.tool === 'star') {
          const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
          for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.45 : 1, an = -Math.PI / 2 + i * Math.PI / 5; const px = cx + rx * r * Math.cos(an), py = cy + ry * r * Math.sin(an); i ? g.lineTo(px, py) : g.moveTo(px, py); }
          g.closePath();
        }
        fill ? g.fill() : g.stroke();
      }
      b.addEventListener('click', e => {
        const tl = e.target.closest('[data-tool]');
        if (tl) { st.tool = tl.dataset.tool; if (st.color === 'eraser') { st.color = '#000000'; b.querySelectorAll('[data-c]').forEach(x => x.setAttribute('aria-pressed', x.dataset.c === st.color)); } b.querySelectorAll('[data-tool]').forEach(x => x.setAttribute('aria-pressed', x === tl)); save(); return; }
        const c = e.target.closest('[data-c]');
        if (c) { st.color = c.dataset.c; b.querySelectorAll('[data-c]').forEach(x => x.setAttribute('aria-pressed', x === c)); save(); return; }
        const a = e.target.closest('[data-act]'); if (!a) return;
        if (a.dataset.act === 'undo' && hist.length) { const im = hist.pop(); if (im.width === cv.width && im.height === cv.height) g.putImageData(im, 0, 0); st.img = cv.toDataURL('image/png'); save(); }
        if (a.dataset.act === 'clear') { hist.push(g.getImageData(0, 0, cv.width, cv.height)); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); st.img = ''; save(); }
        if (a.dataset.act === 'png') { const l = document.createElement('a'); l.download = `${T('drawing')}-${todayISO()}.png`; l.href = cv.toDataURL('image/png'); l.click(); }
      });
      b.addEventListener('change', e => {
        if (e.target.dataset.role === 'size') { st.size = +e.target.value; save(); }
        if (e.target.dataset.role === 'fill') { st.fill = e.target.checked; save(); }
      });
      return () => { ro.disconnect(); clearTimeout(saveTimer); };
    }
  },

  /* ----- Planning de la leçon (icônes Didac, liste ou checklist) ----- */
  plan: {
    icon: 'task-list', w: 400, h: 400, init: () => ({ title: '', items: [], mode: 'check' }),
    mount(b, wd) {
      const st = wd.state; st.mode = st.mode || 'check';
      let editing = !st.items.length, draft = null;
      function render() {
        if (editing) {
          draft = draft || st.items.map(i => ({ ...i }));
          if (!draft.length) draft.push({ t: '', d: false, icon: '' });
          b.innerHTML = `<div class="panel-sub" style="padding:10px;gap:8px">
            <label class="field"><span>${T('planTitle')}</span><input class="inp" data-role="title" value="${esc(st.title)}" placeholder="${T('w_plan')}"></label>
            <div class="row"><span class="lbl-s">${T('display')}</span><div class="seg-s" role="group">${['check', 'list'].map(m => `<button data-mode="${m}" aria-pressed="${st.mode === m}">${T('plan_' + m)}</button>`).join('')}</div></div>
            <div class="plan-edit">${draft.map((it, i) => `<div class="plan-erow">
              <button class="ic-btn" data-pick="${i}" title="${T('chooseIcon')}" aria-label="${T('chooseIcon')}">${it.icon ? ICON(it.icon) : '<span>+</span>'}</button>
              <input class="inp" data-t="${i}" value="${esc(it.t)}" placeholder="${T('activity')} ${i + 1}">
              <button class="w-x" data-up="${i}" aria-label="↑" title="↑">↑</button><button class="w-x" data-del="${i}" aria-label="${T('delete')}" title="${T('delete')}">×</button></div>`).join('')}</div>
            <div class="row"><button class="btn btn--s btn--ghost" data-act="addrow">+ ${T('addActivity')}</button><span style="flex:1"></span><button class="btn" data-act="ok">OK</button></div></div>`;
          return;
        }
        b.innerHTML = `${st.title ? `<div class="plan-title">${esc(st.title)}</div>` : ''}<div class="plan-list">${st.items.map((it, i) => {
          const lead = it.icon ? `<span class="plan-ic">${ICON(it.icon)}</span>` : `<span class="plan-n">${i + 1}</span>`;
          return st.mode === 'check'
            ? `<label class="plan-item ${it.d ? 'is-done' : ''}">${lead}<span class="plan-t">${esc(it.t)}</span><input type="checkbox" data-i="${i}" ${it.d ? 'checked' : ''}></label>`
            : `<div class="plan-item">${lead}<span class="plan-t">${esc(it.t)}</span></div>`;
        }).join('')}</div>
          <div class="ctl"><button class="btn btn--s btn--ghost" data-act="edit">${T('edit')}</button>${st.mode === 'check' ? `<button class="btn btn--s btn--ghost" data-act="uncheck">${T('uncheckAll')}</button>` : ''}</div>`;
      }
      const readDraft = () => { b.querySelectorAll('[data-t]').forEach(inp => { draft[+inp.dataset.t].t = inp.value; }); const ti = $('[data-role=title]', b); if (ti) st.title = ti.value.trim(); };
      b.addEventListener('change', e => { if (e.target.dataset.i !== undefined) { st.items[+e.target.dataset.i].d = e.target.checked; save(); render(); } });
      b.addEventListener('click', e => {
        const md = e.target.closest('[data-mode]'); if (md) { readDraft(); st.mode = md.dataset.mode; save(); render(); return; }
        const pk = e.target.closest('[data-pick]');
        if (pk) { readDraft(); const i = +pk.dataset.pick; iconPicker(draft[i].icon, ic => { draft[i].icon = ic; render(); }); return; }
        const up = e.target.closest('[data-up]'); if (up) { readDraft(); const i = +up.dataset.up; if (i > 0) [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; render(); return; }
        const del = e.target.closest('[data-del]'); if (del) { readDraft(); draft.splice(+del.dataset.del, 1); render(); return; }
        const a = e.target.closest('[data-act]'); if (!a) return;
        if (a.dataset.act === 'addrow') { readDraft(); draft.push({ t: '', d: false, icon: '' }); render(); const ins = b.querySelectorAll('[data-t]'); ins[ins.length - 1].focus(); }
        if (a.dataset.act === 'edit') { editing = true; draft = null; render(); }
        if (a.dataset.act === 'uncheck') { st.items.forEach(i => i.d = false); save(); render(); }
        if (a.dataset.act === 'ok') { readDraft(); st.items = draft.map(i => ({ ...i, t: i.t.trim() })).filter(i => i.t || i.icon); draft = null; editing = !st.items.length; save(); render(); }
      });
      b.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.t !== undefined) { e.preventDefault(); $('[data-act=addrow]', b).click(); } });
      render();
    }
  },

  /* ----- Sticker (icône Didac posée sur la page) ----- */
  sticker: {
    icon: 'star-1', w: 180, h: 200, cls: 'w--sticker', init: () => ({ icon: '', label: '' }),
    mount(b, wd) {
      const st = wd.state;
      function render() {
        if (!st.icon) { b.innerHTML = `<div class="big"><button class="btn btn--s" data-act="pick">${T('chooseIcon')}</button></div>`; return; }
        b.innerHTML = `<button class="stk" data-act="pick" title="${T('changeIcon')}">${ICON(st.icon)}</button>
          <input class="stk-lbl" data-role="lbl" value="${esc(st.label)}" placeholder="${T('stickerLabel')}" aria-label="${T('stickerLabel')}">`;
      }
      b.addEventListener('click', e => { if (e.target.closest('[data-act=pick]')) iconPicker(st.icon, ic => { st.icon = ic; save(); render(); }); });
      b.addEventListener('input', e => { if (e.target.dataset.role === 'lbl') { st.label = e.target.value; save(); } });
      render();
      if (!st.icon) setTimeout(() => iconPicker('', ic => { st.icon = ic; save(); render(); }), 50);
    }
  },

  /* ----- Image ----- */
  image: {
    glyph: 'IMG', w: 480, h: 360, init: () => ({ src: '' }),
    mount(b, wd) {
      const st = wd.state;
      function render() {
        b.innerHTML = st.src ? `<div class="img-box"><img src="${st.src}" alt="${T('w_image')}"></div><div class="ctl"><label class="btn btn--s btn--ghost">${T('changeImage')}<input type="file" accept="image/*" hidden></label></div>`
          : `<div class="big"><div><p class="lbl-s">${T('imageHint')}</p><label class="btn">${T('chooseImage')}<input type="file" accept="image/*" hidden></label></div></div>`;
        $('input', b).onchange = async e => { const f = e.target.files[0]; if (!f) return; st.src = await shrinkImage(f, 1400); if (!save(true)) { st.src = ''; alertBox(T('storageFull')); } render(); };
      }
      render();
    }
  }
};
const ORDER = ['clock', 'timer', 'schedule', 'stopwatch', 'random', 'groups', 'dice', 'countdown', 'plan', 'text', 'sticker', 'image', 'calc', 'draw'];

/* ---------- Choix d'une icône Didac (planning, stickers) ---------- */
function iconPicker(current, onPick) {
  const names = Object.keys(window.DIDAC_ICONS || {}).filter(k => k.startsWith('couleur/')).map(k => k.slice(8));
  openDlg(`<h2>${T('chooseIcon')}</h2>
    <div class="ic-grid">${names.map(n => `<button class="ic-btn ic-btn--l" data-ic="${n}" aria-pressed="${n === current}" title="${n.replace(/-/g, ' ')}" aria-label="${n.replace(/-/g, ' ')}">${ICON(n)}</button>`).join('')}</div>
    <div class="row"><button class="btn btn--ghost btn--s" data-ic="">${T('noIcon')}</button><span style="flex:1"></span><span class="lbl-s">${T('iconCredit')}</span><button class="btn btn--ghost" data-act="closeDlg">${T('cancel')}</button></div>`, body => {
    body.onclick = e => { const b = e.target.closest('[data-ic]'); if (!b) return; closeDlg(); onPick(b.dataset.ic); };
  });
}

/* ---------- Images : réduction avant stockage local ---------- */
function shrinkImage(file, max) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { const im = new Image(); im.onload = () => {
      const k = Math.min(1, max / Math.max(im.width, im.height)); const c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', 0.82)); }; im.onerror = rej; im.src = r.result; };
    r.onerror = rej; r.readAsDataURL(file);
  });
}
function alertBox(msg) { openDlg(`<h2>${T('error')}</h2><p>${msg}</p><div class="row row--end"><button class="btn" data-act="closeDlg">${T('ok')}</button></div>`); }

/* ---------- Calculatrice : analyseur sûr (pas d'eval) ---------- */
function evalExpr(src) {
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s+/g, '');
  let i = 0;
  const peek = () => s[i];
  function num() {
    const m = /^\d*\.?\d+(?:e[+-]?\d+)?|^\d+\./i.exec(s.slice(i)); if (!m) throw new Error('num');
    i += m[0].length; return parseFloat(m[0]);
  }
  function factor() {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') { i++; const v = expr(); if (peek() === ')') i++; return v; }
    return num();
  }
  function term() { let v = factor(); while (peek() === '*' || peek() === '/') { const o = s[i++]; const r = factor(); v = o === '*' ? v * r : v / r; } return v; }
  function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const o = s[i++]; const r = term(); v = o === '+' ? v + r : v - r; } return v; }
  if (!s) return 0;
  const v = expr(); if (i < s.length || !isFinite(v)) throw new Error('syntax'); return v;
}
function fmtNum(v) { return String(parseFloat(v.toPrecision(12))); }

/* ---------- Export PDF (impression navigateur → « Enregistrer en PDF ») ---------- */
function exportPDF(html, title) {
  const base = location.href.replace(/[^/]*$/, '');
  const doc = `<!doctype html><html lang="${S.lang}"><head><meta charset="utf-8"><title>${esc(title || T('textExport'))}</title>
  <link rel="stylesheet" href="${base}fonts/fonts.css">
  <style>@page{size:A4;margin:18mm 20mm 20mm}body{font-family:"Atkinson Hyperlegible Next",Verdana,sans-serif;font-weight:300;font-size:12pt;line-height:1.45;color:#000;margin:0}
  header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1px solid #DADADA;padding-bottom:8px;margin-bottom:18px}
  header img{height:12mm} header span{font-size:9pt;color:#575757;font-weight:400}
  b,strong{font-weight:700}.hl{background:#F5C300}
  footer{position:fixed;bottom:0;left:0;right:0;font-size:8.5pt;color:#575757;font-weight:400;border-top:1px solid #DADADA;padding-top:4px}
  </style></head><body><header><img src="${base}assets/logo.png" alt="didac"><span>${new Date().toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })}</span></header>
  <main>${html}</main><footer>Didac Schulen | Effingerstrasse 31 | 3008 Bern</footer></body></html>`;
  const fr = $('#printFrame');
  fr.onload = () => { setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { console.error(e); } }, 400); fr.onload = null; };
  fr.srcdoc = doc;
}

/* =====================================================================
   PAGES ET WIDGETS À L'ÉCRAN
   ===================================================================== */
const board = $('#board');
board.addEventListener('scroll', () => { board.scrollTop = 0; board.scrollLeft = 0; });
const mounted = new Map(); // id → { el, cleanup }
const page = () => S.pages[S.current] || S.pages[0];
const pageName = (p, i) => p.name || `${T('page')} ${i + 1}`;

function renderTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = S.pages.map((p, i) => `<button class="tab" role="tab" aria-selected="${i === S.current}" data-i="${i}" title="${T('tabHint')}">${esc(pageName(p, i))}</button>`).join('')
    + `<button class="tab tab--add" data-act="addPage" title="${T('addPage')}" aria-label="${T('addPage')}">+</button>`;
}
$('#tabs').addEventListener('click', e => {
  const t = e.target.closest('[data-i]');
  if (t) { const i = +t.dataset.i; if (i === S.current) pageMenu(i); else { S.current = i; save(); renderBoard(); renderTabs(); } return; }
  if (e.target.closest('[data-act=addPage]')) { S.pages.push({ id: uid(), name: '', bg: 'blanc', widgets: [] }); S.current = S.pages.length - 1; save(); renderBoard(); renderTabs(); }
});

function unmountAll() { mounted.forEach(m => { try { m.cleanup && m.cleanup(); } catch (e) { } m.el.remove(); }); mounted.clear(); }
function renderBoard() {
  unmountAll();
  const p = page();
  board.dataset.bg = p.bg || 'blanc';
  board.style.backgroundImage = p.bg === 'image' && p.bgImg ? `url("${p.bgImg}")` : '';
  p.widgets.forEach(wd => mountWidget(wd));
  $('#empty').hidden = p.widgets.length > 0;
  renderDock();
}
function clampBox(wd) {
  const r = board.getBoundingClientRect();
  wd.w = Math.min(Math.max(180, wd.w), Math.max(180, r.width));
  wd.h = Math.min(Math.max(120, wd.h), Math.max(120, r.height));
  wd.x = Math.min(Math.max(0, wd.x), Math.max(0, r.width - wd.w));
  wd.y = Math.min(Math.max(0, wd.y), Math.max(0, r.height - wd.h));
}
function placeEl(el, wd) { el.style.left = wd.x + 'px'; el.style.top = wd.y + 'px'; el.style.width = wd.w + 'px'; el.style.height = wd.h + 'px'; el.style.zIndex = wd.z || 10; }

function mountWidget(wd) {
  const def = WIDGETS[wd.type]; if (!def) return;
  const el = h(`<section class="w" data-id="${wd.id}" aria-label="${T('w_' + wd.type)}">
    <div class="w-head"><span class="w-title">${T('w_' + wd.type)}</span>${def.compact ? `<button class="w-opt" data-act="compact" aria-pressed="${!!wd.state.compact}">${wd.state.compact ? T('fullView') : T('lightView')}</button>` : ''}<button class="w-x" title="${T('close')}" aria-label="${T('close')}">×</button></div>
    <div class="w-body"></div><div class="w-resize" title="${T('resize')}"></div></section>`);
  board.appendChild(el); clampBox(wd); placeEl(el, wd);
  const body = $('.w-body', el);
  const ctx = { el };
  el.classList.toggle('is-compact', !!wd.state.compact);
  if (def.cls) el.classList.add(def.cls);
  const cleanup = def.mount(body, wd, ctx);
  mounted.set(wd.id, { el, cleanup });
  const opt = $('.w-opt', el);
  if (opt) opt.onclick = () => {
    wd.state.compact = !wd.state.compact;
    if (wd.state.compact) { wd.h = Math.min(wd.h, 200); wd.w = Math.min(wd.w, 380); } else { wd.h = Math.max(wd.h, def.h); wd.w = Math.max(wd.w, def.w); }
    save(); remount(wd);
  };

  el.addEventListener('pointerdown', () => { if ((wd.z || 0) < S.z) { wd.z = ++S.z; el.style.zIndex = wd.z; save(); } }, true);
  $('.w-x', el).onclick = () => removeWidget(wd.id);
  body.addEventListener('click', e => { if (e.target.closest('[data-act=openClasses]')) openClasses(); });
  dragify($('.w-head', el), (dx, dy, start) => { wd.x = start.x + dx; wd.y = start.y + dy; clampBox(wd); placeEl(el, wd); }, () => ({ x: wd.x, y: wd.y }));
  dragify($('.w-resize', el), (dx, dy, start) => { wd.w = start.w + dx; wd.h = start.h + dy; clampBox(wd); placeEl(el, wd); }, () => ({ w: wd.w, h: wd.h }));
}
function dragify(handle, move, getStart) {
  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, start = getStart();
    handle.setPointerCapture(e.pointerId);
    const mv = ev => move(ev.clientX - sx, ev.clientY - sy, start);
    const up = () => { handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); save(); };
    handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  });
}
function remount(wd) {
  const m = mounted.get(wd.id); if (m) { try { m.cleanup && m.cleanup(); } catch (e) { } m.el.remove(); mounted.delete(wd.id); }
  mountWidget(wd);
}
function addWidget(type, state) {
  const def = WIDGETS[type], p = page(), r = board.getBoundingClientRect();
  const n = p.widgets.length;
  const wd = { id: uid(), type, w: def.w, h: def.h, x: Math.max(8, (r.width - def.w) / 2 + (n % 6) * 28 - 70), y: Math.max(8, (r.height - def.h) / 2 + (n % 6) * 28 - 70), z: ++S.z, state: Object.assign(def.init(), state || {}) };
  p.widgets.push(wd); save(); mountWidget(wd); $('#empty').hidden = true;
}
function removeWidget(id) {
  const p = page(); p.widgets = p.widgets.filter(w => w.id !== id);
  const m = mounted.get(id); if (m) { try { m.cleanup && m.cleanup(); } catch (e) { } m.el.remove(); mounted.delete(id); }
  $('#empty').hidden = p.widgets.length > 0; save();
}

/* ---------- Dock ---------- */
const BGS = [['blanc', '#FFFFFF'], ['gris1', '#DADADA'], ['rot', '#88004A'], ['gelb', '#F5C300'], ['orange', '#F07D00'], ['blau', '#29B8D8'], ['gruen', '#8CC63F'], ['pink', '#E8507A']];
function renderDock() {
  const p = page();
  $('#dock').innerHTML = ORDER.map(k => {
    const d = WIDGETS[k];
    const vis = d.icon ? ICON(d.icon) : `<span class="glyph" aria-hidden="true">${d.glyph}</span>`;
    return `<button class="tool" data-add="${k}">${vis}<span>${T('w_' + k)}</span></button>`;
  }).join('') + `<span class="sp"></span><span class="dock-sep"></span>
    <div class="bgpick" role="group" aria-label="${T('background')}"><span class="lbl-s">${T('background')}</span>${BGS.map(([k, c]) => `<button class="sw" style="background:${c}" data-bg="${k}" aria-pressed="${p.bg === k}" aria-label="${T('bg_' + k)}" title="${T('bg_' + k)}"></button>`).join('')}
    <label class="btn btn--s btn--ghost" title="${T('bgImageHint')}" ${p.bg === 'image' ? 'style="background:var(--d-gris1)"' : ''}>${T('bg_image')}<input type="file" accept="image/*" hidden data-role="bgimg"></label></div>`;
}
$('#dock').addEventListener('click', e => {
  const a = e.target.closest('[data-add]'); if (a) { addWidget(a.dataset.add); return; }
  const bg = e.target.closest('[data-bg]'); if (bg) { const p = page(); p.bg = bg.dataset.bg; delete p.bgImg; board.dataset.bg = p.bg; board.style.backgroundImage = ''; save(); renderDock(); }
});
$('#dock').addEventListener('change', async e => {
  if (e.target.dataset.role !== 'bgimg' || !e.target.files[0]) return;
  const p = page(), prev = [p.bg, p.bgImg];
  p.bgImg = await shrinkImage(e.target.files[0], 1920); p.bg = 'image';
  if (!save(true)) { [p.bg, p.bgImg] = prev; alertBox(T('storageFull')); }
  renderBoard();
});

/* ---------- Boîte de dialogue générique ---------- */
const dlg = $('#dlg');
function openDlg(html, onReady) {
  $('#dlgBody').innerHTML = html; if (!dlg.open) dlg.showModal(); onReady && onReady($('#dlgBody'));
}
function closeDlg() { if (dlg.open) dlg.close(); }
dlg.addEventListener('click', e => { if (e.target === dlg) closeDlg(); if (e.target.closest('[data-act=closeDlg]')) closeDlg(); });
function confirmBox(msg, okLabel) {
  return new Promise(res => {
    openDlg(`<h2>${T('confirm')}</h2><p>${msg}</p><div class="row row--end"><button class="btn btn--ghost" data-r="0">${T('cancel')}</button><button class="btn" data-r="1">${okLabel || T('ok')}</button></div>`, body => {
      body.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { closeDlg(); res(b.dataset.r === '1'); });
    });
    dlg.addEventListener('close', () => res(false), { once: true });
  });
}

function pageMenu(i) {
  const p = S.pages[i];
  openDlg(`<h2>${T('pageSettings')}</h2>
    <label class="field"><span>${T('pageName')}</span><input class="inp" id="pgName" value="${esc(p.name)}" placeholder="${esc(pageName(p, i))}"></label>
    <div class="row">
      <button class="btn btn--ghost btn--s" data-m="left" ${i === 0 ? 'disabled' : ''}>← ${T('moveLeft')}</button>
      <button class="btn btn--ghost btn--s" data-m="right" ${i === S.pages.length - 1 ? 'disabled' : ''}>${T('moveRight')} →</button>
      <button class="btn btn--ghost btn--s" data-m="dup">${T('duplicate')}</button>
      <button class="btn btn--ghost btn--s" data-m="clear">${T('clearPage')}</button>
      <button class="btn btn--black btn--s" data-m="del" ${S.pages.length < 2 ? 'disabled' : ''}>${T('deletePage')}</button>
    </div>
    <div class="row row--end"><button class="btn" data-m="ok">${T('ok')}</button></div>`, body => {
    const inp = $('#pgName', body); inp.focus(); inp.select();
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('[data-m=ok]', body).click(); } };
    body.onclick = async e => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      p.name = inp.value.trim();
      const m = b.dataset.m;
      if (m === 'left' || m === 'right') { const j = m === 'left' ? i - 1 : i + 1;[S.pages[i], S.pages[j]] = [S.pages[j], S.pages[i]]; S.current = j; }
      if (m === 'dup') { const c = JSON.parse(JSON.stringify(p)); c.id = uid(); c.name = (p.name || pageName(p, i)) + ' (2)'; c.widgets.forEach(w => w.id = uid()); S.pages.splice(i + 1, 0, c); S.current = i + 1; }
      if (m === 'clear') { closeDlg(); if (await confirmBox(T('clearPageQ'))) { p.widgets = []; } }
      if (m === 'del') { closeDlg(); if (await confirmBox(T('deletePageQ').replace('{p}', esc(pageName(p, i))), T('deletePage'))) { S.pages.splice(i, 1); S.current = Math.max(0, Math.min(S.current, S.pages.length - 1)); } }
      closeDlg(); save(); renderTabs(); renderBoard();
    };
  });
}

/* ---------- Gestion des classes ---------- */
function openClasses(editId) {
  if (editId !== undefined) return editClass(editId);
  openDlg(`<h2>${T('classes')}</h2>
    <div class="note">${T('classesNote')}</div>
    <div class="cls-list">${S.classes.length ? S.classes.map(c => `<div class="cls-item"><b>${esc(c.name)}</b><span class="lbl-s">${c.students.length} ${T('students')}</span>
      <button class="btn btn--s btn--ghost" data-edit="${c.id}">${T('edit')}</button></div>`).join('') : `<p class="lbl-s">${T('noClass')}</p>`}</div>
    <div class="row"><button class="btn" data-edit="">${T('newClass')}</button><span style="flex:1"></span>
      <button class="btn btn--ghost btn--s" data-act="exportAll">${T('exportBoard')}</button>
      <label class="btn btn--ghost btn--s">${T('importBoard')}<input type="file" accept=".json,application/json" hidden data-role="import"></label></div>
    <div class="row row--end"><button class="btn btn--ghost" data-act="closeDlg">${T('close')}</button></div>`, body => {
    body.onclick = e => {
      const ed = e.target.closest('[data-edit]'); if (ed) { editClass(ed.dataset.edit || null); return; }
      if (e.target.closest('[data-act=exportAll]')) exportBoard();
    };
    $('[data-role=import]', body).onchange = e => importBoard(e.target.files[0]);
  });
}
function editClass(id) {
  const c = id ? classById(id) : null;
  openDlg(`<h2>${c ? T('editClass') : T('newClass')}</h2>
    <label class="field"><span>${T('className')}</span><input class="inp" id="clsName" value="${esc(c ? c.name : '')}" placeholder="ÜFK 2026/27"></label>
    <label class="field"><span>${T('studentList')}</span><textarea class="inp" id="clsStudents" placeholder="Anna&#10;Luca&#10;Noah">${c ? esc(c.students.map(s => s.name).join('\n')) : ''}</textarea></label>
    <div class="note note--tip"><b>${T('tip')}</b> ${T('studentTip')}</div>
    <div class="row">${c ? `<button class="btn btn--black btn--s" data-act="del">${T('deleteClass')}</button>` : ''}<span style="flex:1"></span>
      <button class="btn btn--ghost" data-act="back">${T('cancel')}</button><button class="btn" data-act="save">${T('save')}</button></div>`, body => {
    $('#clsName', body).focus();
    body.onclick = async e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'back') return openClasses();
      if (a.dataset.act === 'del') {
        closeDlg();
        if (await confirmBox(T('deleteClassQ').replace('{c}', esc(c.name)), T('deleteClass'))) { S.classes = S.classes.filter(x => x.id !== c.id); delete S.presence[c.id]; save(); renderBoard(); }
        return openClasses();
      }
      if (a.dataset.act === 'save') {
        const name = $('#clsName', body).value.trim() || T('class');
        const lines = $('#clsStudents', body).value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const cls = c || { id: uid(), name, students: [] };
        cls.name = name;
        // garder les identifiants des élèves déjà présents (notes, absences)
        const pool = cls.students.slice();
        cls.students = lines.map(n => { const k = pool.findIndex(s => s.name === n); if (k >= 0) return pool.splice(k, 1)[0]; return { id: uid(), name: n }; });
        if (!c) S.classes.push(cls);
        save(); renderBoard(); openClasses();
        window.dispatchEvent(new Event('didac-classes'));
      }
    };
  });
}
function download(name, text, type = 'application/json') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function exportBoard() {
  const data = { app: 'didac-tableau', v: 1, date: new Date().toISOString(), state: S, vault: LS.get('didac-tableau-vault', null), docs: window.DidacDocs ? await window.DidacDocs.exportAll() : [] };
  download(`didac-tableau-${todayISO()}.json`, JSON.stringify(data));
}
function importBoard(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = async () => {
    try {
      const d = JSON.parse(r.result); if (d.app !== 'didac-tableau' || !d.state) throw new Error('format');
      closeDlg();
      if (!(await confirmBox(T('importQ')))) return;
      S = d.state; S.classes = S.classes || []; S.presence = S.presence || {};
      if (d.vault) LS.set('didac-tableau-vault', d.vault);
      if (d.docs && window.DidacDocs) await window.DidacDocs.importAll(d.docs);
      save(true); applyStatic(); renderTabs(); renderBoard();
      window.dispatchEvent(new Event('didac-vault-replaced'));
    } catch (e) { openDlg(`<h2>${T('error')}</h2><p>${T('importErr')}</p><div class="row row--end"><button class="btn" data-act="closeDlg">${T('ok')}</button></div>`); }
  };
  r.readAsText(file);
}

/* ---------- Bandeau ---------- */
document.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { S.lang = b.dataset.lang; save(); applyStatic(); renderTabs(); renderBoard(); window.dispatchEvent(new Event('didac-lang')); });
$('#btnClasses').onclick = () => openClasses();
$('#btnFull').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); };
document.addEventListener('fullscreenchange', applyStatic);
let rzT; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { page().widgets.forEach(wd => { clampBox(wd); const m = mounted.get(wd.id); if (m) placeEl(m.el, wd); }); }, 150); });

/* ---------- API partagée avec prof.js ---------- */
window.DidacApp = {
  T, esc, uid, h, $, LS, ICON, pad, todayISO, locale, download, exportPDF, openDlg, closeDlg, confirmBox, openClasses,
  get state() { return S; }, classById, save, addWidget, iconPicker,
  addPage(name) { const p = { id: uid(), name: name || '', bg: 'blanc', widgets: [] }; S.pages.push(p); save(); renderTabs(); return p.id; },
  goPage(id) { const i = S.pages.findIndex(p => p.id === id); if (i < 0) return; S.current = i; save(); renderTabs(); renderBoard(); }
};

applyStatic(); renderTabs(); renderBoard();
})();
