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
  const nl = (navigator.language || '').toLowerCase().slice(0, 2);
  return { lang: ['de', 'en', 'it'].includes(nl) ? nl : 'fr', pages: [{ id: uid(), name: '', bg: 'blanc', widgets: [] }], current: 0, classes: [], presence: {}, z: 10 };
}
let S = LS.get(KEY, null) || defaultState();
if (!S.pages || !S.pages.length) S = defaultState();
S.classes = S.classes || []; S.presence = S.presence || {};
/* Cours = ensembles de pages. Les pages sans cours (anciennes versions) vont dans « Mes pages ». */
const COURSE_COLORS = ['rot', 'blau', 'gruen', 'gelb', 'orange', 'pink'];
function ensureCourses() {
  S.courses = Array.isArray(S.courses) ? S.courses : [];
  const ok = id => S.courses.some(c => c.id === id);
  const lost = S.pages.filter(p => !ok(p.course));
  if (lost.length || !S.courses.length) {
    let c = S.courses.find(c => c.auto); if (!c) { c = { id: uid(), name: '', color: 'rot', auto: true, created: Date.now() }; S.courses.unshift(c); }
    lost.forEach(p => { p.course = c.id; });
  }
}
ensureCourses();
let HOME = true; // le site s'ouvre sur l'accueil
let saveT = null;
function save(now) {
  clearTimeout(saveT);
  if (now) return LS.set(KEY, S); saveT = setTimeout(() => LS.set(KEY, S), 300); return true;
}
window.addEventListener('beforeunload', () => LS.set(KEY, S));

/* ---------- Langue ---------- */
const T = k => { const d = window.DIDAC_I18N[S.lang] || {}; return d[k] ?? window.DIDAC_I18N.fr[k] ?? k; };
const locale = () => ({ de: 'de-CH', en: 'en-GB', it: 'it-CH' }[S.lang] || 'fr-CH');
function applyStatic() {
  document.documentElement.lang = S.lang;
  document.title = T('appTitle');
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = T(el.dataset.t); });
  document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === S.lang));
  $('#btnClasses').innerHTML = `<span class="ico-on-rot">${ICON('class-lesson', 'blanc')}</span><span class="ico-on-white">${ICON('class-lesson')}</span><span class="lbl">${T('classes')}</span>`;
  $('#btnProf').innerHTML = `<span class="ico-on-rot">${ICON('graduation-cap', 'blanc')}</span><span class="ico-on-white">${ICON('graduation-cap')}</span><span class="lbl">${T('profSpace')}</span>`;
  $('#btnFull').innerHTML = `<span class="lbl">${document.fullscreenElement ? T('exitFull') : T('fullscreen')}</span>`;
  $('#btnFull').title = T('fullscreen');
  if ($('#dockShow')) applyDock();
  applySide(); applyHome();
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
    icon: 'arrow-roadmap', w: 460, h: 380, compact: true, init: () => ({ mode: 'mine', sound: true, picked: [], compact: false }),
    mount(b, wd, ctx) {
      const st = wd.state; let lastKey = null;
      const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
      const fmtT = sec => fmtHMS(Math.max(0, Math.ceil(sec)), sec >= 3600);
      function segments(now) {
        const sched = S.schedule || { slots: DIDAC_SLOTS, cells: {} };
        const day = now.getDay();
        // mode « créneaux choisis » : les créneaux cliqués par le prof, tous les jours, sans emploi du temps
        if (st.mode === 'pick') return withPauses(sched, sched.slots.map((sl, i) => ({ sl, i })).filter(({ sl, i }) => !sl.brk && (st.picked || []).includes(i))
          .map(({ sl }) => ({ type: 'lesson', s: toMin(sl.s), e: toMin(sl.e), label: T('lesson') })));
        if (day < 1 || day > 5) return [];
        const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, once = sched.once || {};
        const cellOf = i => once[iso + '|' + i] || (sched.cells || {})[day + '-' + i];
        const hasMine = sched.slots.some((sl, i) => !sl.brk && cellOf(i));
        const mode = st.mode === 'mine' && (Object.keys(sched.cells || {}).length || Object.keys(once).length) ? 'mine' : 'all';
        if (mode === 'mine' && !hasMine) return [];
        const L = sched.slots.map((sl, i) => ({ sl, i })).filter(({ sl, i }) => !sl.brk && (mode === 'all' || cellOf(i)))
          .map(({ sl, i }) => { const c = cellOf(i); return { type: 'lesson', s: toMin(sl.s), e: toMin(sl.e), label: c ? [c.subject, c.cls].filter(Boolean).join(' · ') || T('lesson') : T('lesson'), room: c && c.room, color: c && c.color }; });
        return withPauses(sched, L);
      }
      function withPauses(sched, L) {
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
            <div class="ctl full-only"><select class="inp" data-role="mode" aria-label="${T('display')}"><option value="mine" ${st.mode === 'mine' ? 'selected' : ''}>${T('schMine')}</option><option value="all" ${st.mode === 'all' ? 'selected' : ''}>${T('schAll')}</option><option value="pick" ${st.mode === 'pick' ? 'selected' : ''}>${T('schPick')}</option></select>
              <label class="chk"><input type="checkbox" data-role="sound" ${st.sound ? 'checked' : ''}> ${T('sound')}</label></div>
            ${st.mode === 'mine' && !Object.keys((S.schedule || {}).cells || {}).length ? `<div class="hint full-only">${T('schHint')}</div>` : ''}
            ${st.mode === 'pick' ? `<div class="sch-pick full-only" role="group" aria-label="${T('schPick')}"><span class="lbl-s">${T('schPickHint')}</span>${(S.schedule || { slots: DIDAC_SLOTS }).slots.map((sl, i) => sl.brk ? '' : `<button class="sch-slot" data-slot="${i}" aria-pressed="${(st.picked || []).includes(i)}">${sl.s}–${sl.e}</button>`).join('')}</div>` : ''}`;
        }
        const lf = $('.sch-left', b); if (lf) lf.textContent = fmtT(left);
        const ring = $('.ring', b); if (ring) ring.setAttribute('stroke-dasharray', `${pct} 100`);
      }
      b.addEventListener('change', e => {
        if (e.target.dataset.role === 'mode') { st.mode = e.target.value; lastKey = null; save(); b.innerHTML = ''; upd(); }
        if (e.target.dataset.role === 'sound') { st.sound = e.target.checked; save(); }
      });
      b.addEventListener('click', e => {
        const sb = e.target.closest('[data-slot]'); if (!sb) return;
        const i = +sb.dataset.slot; st.picked = st.picked || [];
        st.picked = st.picked.includes(i) ? st.picked.filter(x => x !== i) : [...st.picked, i].sort((a, c) => a - c);
        save(); b.innerHTML = ''; lastKey = null; upd();
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
    icon: 'user-single-neutral-male', w: 460, h: 320, init: () => ({ classId: null, noRepeat: true, drawn: [], last: null, view: 'draw', list: '' }),
    mount(b, wd) {
      const st = wd.state; if (st.list === undefined) st.list = '';
      const isList = () => st.classId === '__list';
      if (!isList() && !classById(st.classId)) st.classId = S.classes[0] ? S.classes[0].id : '__list';
      let spinning = null;
      // éléments tirables : élèves présents de la classe, ou lignes de la liste libre
      const items = () => isList() ? st.list.split('\n').map(x => x.trim()).filter(Boolean).map((name, i) => ({ id: 'L' + i + ':' + name, name }))
        : presentStudents(classById(st.classId));
      const srcSelect = () => `<select class="inp" data-role="cls" aria-label="${T('source')}">${S.classes.map(c => `<option value="${c.id}" ${c.id === st.classId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="__list" ${isList() ? 'selected' : ''}>${T('freeList')}</option></select>`;
      function render() {
        const all = items();
        const pool = all.filter(s => !st.noRepeat || !st.drawn.includes(s.id));
        const lastS = all.find(s => s.id === st.last) || (isList() ? null : (classById(st.classId) || { students: [] }).students.find(s => s.id === st.last));
        const sideBtn = isList() ? `<button class="btn btn--s btn--ghost" data-act="view">${st.view === 'edit' ? T('back') : T('editList')}</button>`
          : `<button class="btn btn--s btn--ghost" data-act="view">${st.view === 'draw' ? T('presence') : T('back')}</button>`;
        const head = `<div class="ctl">${srcSelect()}<label class="chk"><input type="checkbox" data-role="norep" ${st.noRepeat ? 'checked' : ''}> ${T('noRepeat')}</label>${sideBtn}</div>`;
        if (isList() && (st.view === 'edit' || !all.length)) {
          b.innerHTML = `${head}<textarea class="inp rn-list" data-role="list" placeholder="${T('freeListPh')}" aria-label="${T('freeList')}">${esc(st.list)}</textarea>
            <div class="ctl"><button class="btn" data-act="listOk">${T('ok')}</button><span class="lbl-s">${T('nItems').replace('{n}', all.length)}</span></div>`;
          return;
        }
        if (!isList() && st.view === 'presence') { b.innerHTML = `${head}<div class="hint" style="padding-top:4px">${T('presenceHint')}</div><div class="panel-sub">${presenceChips(classById(st.classId))}</div>`; return; }
        b.innerHTML = `${head}<div class="big"><div><div class="rn-name">${lastS ? esc(lastS.name) : '?'}</div>
            <div class="rn-count">${st.noRepeat ? T(isList() ? 'remainingItems' : 'remaining').replace('{n}', pool.length) : T(isList() ? 'nItems' : 'presentCount').replace('{n}', all.length)}</div></div></div>
          <div class="ctl"><button class="btn" data-act="draw" ${all.length ? '' : 'disabled'}>${pool.length || !st.noRepeat ? T('draw') : T('restart')}</button>
            ${st.noRepeat ? `<button class="btn btn--ghost" data-act="restart">${T('restart')}</button>` : ''}</div>`;
      }
      b.addEventListener('change', e => {
        if (e.target.dataset.role === 'cls') { st.classId = e.target.value; st.drawn = []; st.last = null; st.view = 'draw'; save(); render(); }
        if (e.target.dataset.role === 'norep') { st.noRepeat = e.target.checked; st.drawn = []; save(); render(); }
      });
      b.addEventListener('input', e => { if (e.target.dataset.role === 'list') { st.list = e.target.value; save(); const n = $('.ctl .lbl-s', b); if (n) n.textContent = T('nItems').replace('{n}', items().length); } });
      b.addEventListener('click', e => {
        const chip = e.target.closest('.chip'); if (chip) { toggleAbsent(st.classId, chip.dataset.sid); chip.setAttribute('aria-pressed', !isAbsent(st.classId, chip.dataset.sid)); return; }
        const a = e.target.closest('[data-act]'); if (!a || spinning) return;
        if (a.dataset.act === 'view') { st.view = st.view === 'draw' ? (isList() ? 'edit' : 'presence') : 'draw'; save(); render(); }
        if (a.dataset.act === 'listOk') { st.view = 'draw'; st.drawn = []; st.last = null; save(); render(); }
        if (a.dataset.act === 'restart') { st.drawn = []; st.last = null; save(); render(); }
        if (a.dataset.act === 'draw') {
          const all = items(); if (!all.length) return;
          const pool = all.filter(s => !st.noRepeat || !st.drawn.includes(s.id));
          if (!pool.length) { st.drawn = []; save(); render(); return; }
          const pick = pool[Math.floor(Math.random() * pool.length)];
          const nameEl = $('.rn-name', b); nameEl.classList.add('is-spin'); let n = 0;
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
  /* ----- Flashcards : une ligne = une carte (« recto ; verso »), recto seul ou recto-verso ----- */
  flash: {
    icon: 'cards', w: 520, h: 360, init: () => ({ text: '', mode: 'rv', reverse: false, shuffle: true, view: 'edit', order: [], pos: 0, known: [], flipped: false }),
    mount(b, wd) {
      const st = wd.state;
      const cards = () => st.text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.split(/\s*(?:;|\t|\s=\s|\s[–—-]\s)\s*/); return { f: m[0], b: m.slice(1).join(' ; ') };
      });
      function deal() {
        const n = cards().length; st.order = [...Array(n).keys()];
        if (st.shuffle) for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [st.order[i], st.order[j]] = [st.order[j], st.order[i]]; }
        st.pos = 0; st.known = []; st.flipped = false;
      }
      const left = () => st.order.filter(i => !st.known.includes(i));
      function render() {
        const C = cards();
        if (st.view === 'edit' || !C.length) {
          b.innerHTML = `<textarea class="inp rn-list" data-role="text" placeholder="${T('flashPh')}" aria-label="${T('flashCards')}">${esc(st.text)}</textarea>
            <div class="ctl"><div class="seg-s" role="group" aria-label="${T('flashMode')}">
              <button data-mode="recto" aria-pressed="${st.mode === 'recto'}">${T('flashRecto')}</button><button data-mode="rv" aria-pressed="${st.mode === 'rv'}">${T('flashRV')}</button></div>
              <label class="chk"><input type="checkbox" data-role="shuffle" ${st.shuffle ? 'checked' : ''}> ${T('shuffle')}</label>
              ${st.mode === 'rv' ? `<label class="chk"><input type="checkbox" data-role="reverse" ${st.reverse ? 'checked' : ''}> ${T('flashReverse')}</label>` : ''}
              <span style="flex:1"></span><button class="btn" data-act="start" ${C.length ? '' : 'disabled'}>${T('flashStart')} (${C.length})</button></div>`;
          return;
        }
        if (st.order.length !== C.length) deal();
        const L = left();
        if (!L.length) {
          b.innerHTML = `<div class="big"><div><div class="fc-done">${ICON('trophy')}<b>${T('flashAllKnown')}</b></div></div></div>
            <div class="ctl"><button class="btn" data-act="again">${T('restart')}</button><button class="btn btn--ghost" data-act="edit">${T('editList')}</button></div>`;
          return;
        }
        st.pos = Math.min(st.pos, L.length - 1);
        const c = C[L[st.pos]], front = st.mode === 'rv' && st.reverse ? c.b || c.f : c.f, back = st.mode === 'rv' && st.reverse ? c.f : c.b;
        const rv = st.mode === 'rv' && back;
        b.innerHTML = `<div class="fc-wrap"><button class="fc ${st.flipped && rv ? 'is-flipped' : ''}" data-act="flip" aria-label="${rv ? T('flashFlip') : ''}" ${rv ? '' : 'tabindex="-1"'}>
            <span class="fc-face fc-front"><span>${esc(front)}</span></span>${rv ? `<span class="fc-face fc-back"><span>${esc(back)}</span></span>` : ''}</button></div>
          <div class="ctl"><button class="btn btn--ghost btn--s" data-act="prev" aria-label="${T('prev')}" ${st.pos ? '' : 'disabled'}>←</button>
            <span class="lbl-s fc-count">${st.pos + 1} / ${L.length}${st.known.length ? ` · ✓ ${st.known.length}` : ''}</span>
            <button class="btn btn--ghost btn--s" data-act="next" aria-label="${T('next')}" ${st.pos < L.length - 1 ? '' : 'disabled'}>→</button>
            ${rv ? `<button class="btn btn--s" data-act="flip">${T('flashFlip')}</button>` : ''}
            <button class="btn btn--ghost btn--s" data-act="known" title="${T('flashKnownHint')}">✓ ${T('flashKnown')}</button>
            <span style="flex:1"></span>
            <button class="btn btn--ghost btn--s full-only" data-act="again">${T('shuffle')}</button><button class="btn btn--ghost btn--s full-only" data-act="edit">${T('editList')}</button></div>`;
      }
      b.addEventListener('input', e => { if (e.target.dataset.role === 'text') { st.text = e.target.value; save(); const s = $('[data-act=start]', b); if (s) { const n = cards().length; s.disabled = !n; s.textContent = `${T('flashStart')} (${n})`; } } });
      b.addEventListener('change', e => {
        const r = e.target.dataset.role;
        if (r === 'shuffle') { st.shuffle = e.target.checked; save(); }
        if (r === 'reverse') { st.reverse = e.target.checked; save(); }
      });
      b.addEventListener('click', e => {
        const md = e.target.closest('[data-mode]'); if (md) { st.mode = md.dataset.mode; save(); render(); return; }
        const a = e.target.closest('[data-act]'); if (!a) return;
        const act = a.dataset.act, L = left();
        if (act === 'start' || act === 'again') { deal(); st.view = 'play'; }
        if (act === 'edit') st.view = 'edit';
        if (act === 'flip') { if (st.mode !== 'rv') return; st.flipped = !st.flipped; const f = $('.fc', b); if (f) { f.classList.toggle('is-flipped', st.flipped); save(); return; } }
        if (act === 'next' && st.pos < L.length - 1) { st.pos++; st.flipped = false; }
        if (act === 'prev' && st.pos > 0) { st.pos--; st.flipped = false; }
        if (act === 'known') { st.known.push(L[st.pos]); st.flipped = false; }
        save(); render();
      });
      b.addEventListener('keydown', e => {
        if (st.view === 'edit' || e.target.tagName === 'TEXTAREA') return;
        const k = { ArrowRight: 'next', ArrowLeft: 'prev', ' ': 'flip', Enter: 'flip' }[e.key]; if (!k) return;
        e.preventDefault(); const btn = $(`[data-act=${k}]`, b); if (btn && !btn.disabled) btn.click(); const f = $('.fc', b); if (f) f.focus();
      });
      render();
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
        b.innerHTML = `<div class="big"><div><div class="dice-row" data-n="${st.values.length}">${st.values.map(face).join('')}</div>${st.count > 1 && st.kind !== 'coin' ? `<div class="dice-sum">${T('total')} : ${sum}</div>` : ''}</div></div>
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
          <button class="tb tb-tbl" data-tbl="new" title="${T('insertTable')}" aria-label="${T('insertTable')}">${TBL_SVG}</button>
          <span class="tx-tblctl" hidden>
            <button class="tb" data-tbl="rowA" title="${T('tblRowAdd')}">+ ${T('tblRow')}</button>
            <button class="tb" data-tbl="colA" title="${T('tblColAdd')}">+ ${T('tblCol')}</button>
            <button class="tb" data-tbl="rowD" title="${T('tblRowDel')}">− ${T('tblRow')}</button>
            <button class="tb" data-tbl="colD" title="${T('tblColDel')}">− ${T('tblCol')}</button>
            <button class="tb" data-tbl="head" title="${T('tblHead')}">${T('tblHeadShort')}</button>
            <button class="tb" data-tbl="del" title="${T('tblDel')}" aria-label="${T('tblDel')}">${TBL_SVG}×</button>
          </span>
          <span class="sp"></span>
          <button class="btn btn--s" data-act="pdf">PDF</button>
        </div>
        <div class="tx-area" contenteditable="true" spellcheck="true" data-ph="${T('textPh')}"></div>`;
      const area = $('.tx-area', b);
      area.innerHTML = st.html; area.style.fontSize = st.size + 'px';
      const store = () => { st.html = area.innerHTML; save(); };
      area.addEventListener('input', store);
      // coller : tableaux de Word / Excel / Google Sheets gardés (nettoyés), sinon texte brut
      area.addEventListener('paste', e => {
        e.preventDefault(); const cd = e.clipboardData || window.clipboardData;
        const html = cd.getData('text/html'), t = cd.getData('text/plain');
        let out = null;
        if (html && /<table/i.test(html)) out = pasteTableHTML(html);
        else if (/\t/.test(t) && t.trim().includes('\n') || /\t/.test(t) && !html) out = tsvTable(t);
        if (out) document.execCommand('insertHTML', false, out + '<p><br></p>'); else document.execCommand('insertText', false, t);
        store();
      });
      const cellAt = () => { const sel = window.getSelection(); if (!sel.rangeCount) return null; const n = sel.anchorNode; const el = n && (n.nodeType === 1 ? n : n.parentElement); const c = el && el.closest('td, th'); return c && area.contains(c) ? c : null; };
      const ctl = $('.tx-tblctl', b);
      const syncCtl = () => { ctl.hidden = !cellAt(); };
      document.addEventListener('selectionchange', syncCtl);
      const putCaret = el => { const r = document.createRange(); r.selectNodeContents(el); r.collapse(true); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); };
      const newCell = tag => { const c = document.createElement(tag); c.innerHTML = '<br>'; return c; };
      function tableCmd(k) {
        if (k === 'new') { openTableDlg(); return; }
        const c = cellAt(); if (!c) return;
        const tr = c.parentElement, tbl = c.closest('table'), ci = [...tr.children].indexOf(c), rows = [...tbl.rows];
        if (k === 'rowA') { const nr = document.createElement('tr'); [...tr.children].forEach(() => nr.appendChild(newCell('td'))); tr.after(nr); putCaret(nr.cells[Math.min(ci, nr.cells.length - 1)]); }
        if (k === 'colA') { rows.forEach(r => { const ref = r.cells[Math.min(ci, r.cells.length - 1)]; ref.after(newCell(ref.tagName.toLowerCase())); }); putCaret(tr.cells[ci + 1]); }
        if (k === 'rowD') { if (rows.length < 2) { tbl.remove(); } else { const nxt = tr.nextElementSibling || tr.previousElementSibling; tr.remove(); putCaret(nxt.cells[0]); } }
        if (k === 'colD') { if (tr.cells.length < 2) tbl.remove(); else rows.forEach(r => { const x = r.cells[Math.min(ci, r.cells.length - 1)]; x && x.remove(); }); }
        if (k === 'head') { const r0 = tbl.rows[0], to = r0.cells[0].tagName === 'TH' ? 'td' : 'th'; [...r0.cells].forEach(x => { const y = document.createElement(to); y.innerHTML = x.innerHTML; x.replaceWith(y); }); }
        if (k === 'del') tbl.remove();
        store(); syncCtl();
      }
      function openTableDlg() {
        const sel = window.getSelection(), saved = sel.rangeCount && area.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
        openDlg(`<h2>${T('insertTable')}</h2>
          <div class="row"><label class="field"><span>${T('tblRows')}</span><input class="inp" type="number" id="tbR" min="1" max="30" value="3" style="width:90px"></label>
          <label class="field"><span>${T('tblCols')}</span><input class="inp" type="number" id="tbC" min="1" max="12" value="3" style="width:90px"></label></div>
          <label class="chk"><input type="checkbox" id="tbH" checked> ${T('tblHead')}</label>
          <p class="lbl-s" style="margin:0">${T('tblPasteHint')}</p>
          <div class="row row--end"><button class="btn btn--ghost" data-act="closeDlg">${T('cancel')}</button><button class="btn" id="tbOk">${T('insert')}</button></div>`, body => {
          $('#tbOk', body).onclick = () => {
            const R = Math.max(1, Math.min(30, +$('#tbR', body).value || 3)), C = Math.max(1, Math.min(12, +$('#tbC', body).value || 3)), H = $('#tbH', body).checked;
            const html = '<table class="tx-tbl" data-new="1">' + Array.from({ length: R }, (_, r) => '<tr>' + Array.from({ length: C }, () => r === 0 && H ? '<th><br></th>' : '<td><br></td>').join('') + '</tr>').join('') + '</table><p><br></p>';
            closeDlg(); area.focus();
            const s2 = window.getSelection(); s2.removeAllRanges();
            if (saved) s2.addRange(saved); else { const r = document.createRange(); r.selectNodeContents(area); r.collapse(false); s2.addRange(r); }
            document.execCommand('insertHTML', false, html);
            const nt = area.querySelector('table[data-new]'); if (nt) { nt.removeAttribute('data-new'); putCaret(nt.rows[0].cells[0]); }
            store(); syncCtl();
          };
        });
      }
      area.addEventListener('keydown', e => {
        if (e.key !== 'Tab') return; const c = cellAt(); if (!c) return;
        e.preventDefault(); const cells = [...c.closest('table').querySelectorAll('td, th')], i = cells.indexOf(c);
        let n = cells[i + (e.shiftKey ? -1 : 1)];
        if (!n && !e.shiftKey) { putCaret(c); tableCmd('rowA'); n = c.parentElement.nextElementSibling.cells[0]; }
        if (n) putCaret(n);
      });
      b.addEventListener('mousedown', e => { if (e.target.closest('.tb')) e.preventDefault(); });
      b.addEventListener('click', e => {
        const tb = e.target.closest('[data-tbl]'); if (tb) { tableCmd(tb.dataset.tbl); return; }
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
      return () => document.removeEventListener('selectionchange', syncCtl);
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

  /* ----- Symboles de travail : volume, forme sociale, activité (icônes Didac) ----- */
  work: {
    icon: 'chat-two-bubbles-oval', w: 560, h: 300, compact: true, init: () => ({ vol: 0, soc: 0, act: null, compact: false }),
    mount(b, wd) {
      const st = wd.state;
      const CATS = [
        ['vol', T('wkVolume'), [['ear-hearing', 'wk_silence'], ['chat-bubble-oval', 'wk_whisper'], ['chat-two-bubbles-oval', 'wk_talk']]],
        ['soc', T('wkSocial'), [['user-single-neutral-male', 'wk_alone'], ['user-multiple-group', 'wk_pairs'], ['collaborations-idea', 'wk_group'], ['class-lesson', 'wk_plenum']]],
        ['act', T('wkActivity'), [['ear-hearing', 'wk_listen'], ['book-reading', 'wk_read'], ['pencil', 'wk_write'], ['politics-speech', 'wk_speak'], ['magnifying-glass', 'wk_search'], ['computer-pc-desktop', 'wk_computer'], ['help-question-1', 'wk_ask']]]];
      function render() {
        const shown = CATS.filter(([k]) => st[k] !== null && st[k] !== undefined);
        b.innerHTML = `<div class="wk-tiles">${shown.length ? shown.map(([k, , L]) => { const [ic, lb] = L[st[k]] || L[0];
            return `<button class="wk-tile" data-cycle="${k}" title="${T('wkCycle')}">${ICON(ic)}<span>${T(lb)}</span></button>`; }).join('') : `<p class="lbl-s">${T('wkNone')}</p>`}</div>
          <div class="wk-pick full-only">${CATS.map(([k, name, L]) => `<div class="wk-row"><span class="lbl-s">${name}</span>
            <button class="wk-opt" data-set="${k}|" aria-pressed="${st[k] === null}">—</button>${L.map(([ic, lb], i) => `<button class="wk-opt" data-set="${k}|${i}" aria-pressed="${st[k] === i}" title="${T(lb)}" aria-label="${T(lb)}">${ICON(ic)}</button>`).join('')}</div>`).join('')}</div>`;
      }
      b.addEventListener('click', e => {
        const s = e.target.closest('[data-set]'); if (s) { const [k, v] = s.dataset.set.split('|'); st[k] = v === '' ? null : +v; save(); render(); return; }
        const c = e.target.closest('[data-cycle]'); if (c) { const k = c.dataset.cycle, L = CATS.find(x => x[0] === k)[2]; st[k] = (st[k] + 1) % L.length; save(); render(); }
      });
      render();
    }
  },

  /* ----- Feu tricolore ----- */
  light: {
    glyph: '●', w: 260, h: 420, compact: true, init: () => ({ on: 2, labels: ['', '', ''], compact: false }),
    mount(b, wd) {
      const st = wd.state; st.labels = st.labels || ['', '', ''];
      const COLS = ['rot', 'gelb', 'gruen'], DEF = ['tl_red', 'tl_yellow', 'tl_green'];
      function render() {
        b.innerHTML = `<div class="tl"><div class="tl-box">${COLS.map((c, i) => `<button class="tl-lamp tl-${c} ${st.on === i ? 'is-on' : ''}" data-lamp="${i}" aria-pressed="${st.on === i}" aria-label="${esc(st.labels[i] || T(DEF[i]))}"></button>`).join('')}</div>
          ${st.on !== null && st.labels[st.on] ? `<div class="tl-cap">${esc(st.labels[st.on])}</div>` : ''}</div>
          <div class="tl-edit full-only">${COLS.map((c, i) => `<label class="tl-in"><span class="sw" style="background:var(--d-${c})"></span><input class="inp" data-lbl="${i}" value="${esc(st.labels[i])}" placeholder="${T('tlCaption')}" aria-label="${T('tlCaption')} ${T(DEF[i])}"></label>`).join('')}</div>`;
      }
      b.addEventListener('click', e => { const l = e.target.closest('[data-lamp]'); if (l) { const i = +l.dataset.lamp; st.on = st.on === i ? null : i; save(); render(); } });
      b.addEventListener('input', e => { const i = e.target.dataset.lbl; if (i !== undefined) { st.labels[+i] = e.target.value; save(); const cap = $('.tl-cap', b); if (+i === st.on) { if (cap) cap.textContent = e.target.value; else render(); } } });
      render();
    }
  },

  /* ----- Devoirs : repris de l'agenda (copie non chiffrée des textes de devoirs) ----- */
  homework: {
    icon: 'book-reading', w: 480, h: 320, compact: true, init: () => ({ classId: '', compact: false }),
    mount(b, wd) {
      const st = wd.state;
      function render() {
        const all = S.homework || [], today = todayISO();
        const L0 = all.filter(h => !st.classId || h.classId === st.classId);
        // devoirs « en cours » : depuis la dernière leçon passée (ou d'aujourd'hui) + les suivants planifiés
        const past = L0.filter(h => h.date <= today), start = past.length ? past[past.length - 1].date : today;
        const L = L0.filter(h => h.date >= start).slice(0, 6);
        const fmt = d => new Date(d + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
        const classes = [...new Map(all.filter(h => h.classId).map(h => [h.classId, h.cls])).entries()];
        b.innerHTML = `<div class="ctl full-only"><select class="inp" data-role="cls" aria-label="${T('class')}"><option value="">${T('allClasses')}</option>${classes.map(([id, n]) => `<option value="${id}" ${id === st.classId ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
          <div class="hw-list">${L.length ? L.map(h => `<div class="hw-item ${h.date === today ? 'is-today' : h.date > today ? 'is-next' : ''}"><div class="hw-top"><b>${T('hwGiven')} ${fmt(h.date)}</b>${!st.classId && h.cls ? `<span class="tag">${esc(h.cls)}</span>` : ''}${h.topic ? `<span class="lbl-s">${esc(h.topic)}</span>` : ''}</div><div class="rt">${cleanHTML(h.html)}</div></div>`).join('')
            : `<div class="big"><p class="lbl-s">${T('hwEmpty')}</p></div>`}</div>`;
      }
      b.addEventListener('change', e => { if (e.target.dataset.role === 'cls') { st.classId = e.target.value; save(); render(); } });
      window.addEventListener('didac-homework', render);
      render();
      return () => window.removeEventListener('didac-homework', render);
    }
  },

  /* ----- Sondage rapide : l'enseignant·e compte les mains levées ----- */
  poll: {
    icon: 'politics-vote-2', w: 520, h: 340, compact: true, init: () => ({ kind: 'thumbs', q: '', labels: ['A', 'B', 'C', 'D'], counts: [0, 0, 0, 0], hide: false, compact: false }),
    mount(b, wd) {
      const st = wd.state;
      const SURF = ['gelb', 'blau', 'gruen', 'orange'];
      const opts = () => st.kind === 'thumbs' ? [['like-1', T('pl_yes')], ['help-question-1', T('pl_unsure')], ['sad-face', T('pl_no')]]
        : st.kind === 'yn' ? [['like-1', T('pl_yes')], ['sad-face', T('pl_no')]] : st.labels.map(l => [null, l]);
      let lastVote = [];
      function render() {
        const O = opts(), C = O.map((_, i) => st.counts[i] || 0), tot = C.reduce((a, c) => a + c, 0), mx = Math.max(1, ...C);
        b.innerHTML = `<input class="pl-q" data-role="q" value="${esc(st.q)}" placeholder="${T('pollQ')}" aria-label="${T('pollQ')}">
          <div class="pl-bars">${O.map(([ic, lb], i) => `<button class="pl-opt" data-vote="${i}" title="${T('pollAdd')}">
            <span class="pl-track"><span class="pl-bar" style="height:${st.hide ? 0 : C[i] / mx * 100}%;background:var(--d-${SURF[i]})"></span></span>
            <span class="pl-n">${st.hide ? '?' : C[i]}</span><span class="pl-lb">${ic ? ICON(ic) : ''}<span>${esc(lb)}</span></span></button>`).join('')}</div>
          <div class="ctl"><span class="lbl-s">${T('pollTotal').replace('{n}', tot)}</span><span style="flex:1"></span>
            <button class="btn btn--ghost btn--s" data-act="hide">${st.hide ? T('pollShow') : T('pollHide')}</button>
            <button class="btn btn--ghost btn--s" data-act="undo" ${tot ? '' : 'disabled'} aria-label="${T('pollUndo')}" title="${T('pollUndo')}">−1</button>
            <button class="btn btn--ghost btn--s" data-act="reset">${T('reset')}</button></div>
          <div class="ctl full-only"><div class="seg-s" role="group" aria-label="${T('pollKind')}">${['thumbs', 'yn', 'abcd'].map(k => `<button data-kind="${k}" aria-pressed="${st.kind === k}">${T('pk_' + k)}</button>`).join('')}</div>
            ${st.kind === 'abcd' ? st.labels.map((l, i) => `<input class="inp pl-in" data-lbl="${i}" value="${esc(l)}" aria-label="${T('pollOption')} ${i + 1}">`).join('') : ''}</div>`;
      }
      b.addEventListener('click', e => {
        const v = e.target.closest('[data-vote]'); if (v) { const i = +v.dataset.vote; st.counts[i] = (st.counts[i] || 0) + 1; lastVote.push(i); save(); render(); return; }
        const k = e.target.closest('[data-kind]'); if (k) { st.kind = k.dataset.kind; st.counts = [0, 0, 0, 0]; lastVote = []; save(); render(); return; }
        const a = e.target.closest('[data-act]'); if (!a) return;
        if (a.dataset.act === 'hide') st.hide = !st.hide;
        if (a.dataset.act === 'reset') { st.counts = [0, 0, 0, 0]; lastVote = []; }
        if (a.dataset.act === 'undo') { const i = lastVote.length ? lastVote.pop() : st.counts.findIndex(c => c > 0); if (i >= 0 && st.counts[i] > 0) st.counts[i]--; }
        save(); render();
      });
      b.addEventListener('input', e => {
        if (e.target.dataset.role === 'q') { st.q = e.target.value; save(); }
        const i = e.target.dataset.lbl;
        if (i !== undefined) { st.labels[+i] = e.target.value; save(); const lb = b.querySelectorAll('.pl-lb span')[+i]; if (lb) lb.textContent = e.target.value; }
      });
      render();
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
const ORDER = ['clock', 'timer', 'schedule', 'stopwatch', 'random', 'flash', 'groups', 'dice', 'countdown', 'plan', 'homework', 'work', 'light', 'poll', 'text', 'sticker', 'image', 'calc', 'draw'];

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

/* ---------- Texte enrichi sûr (gras + surlignage Didac), partagé avec l'espace prof ---------- */
const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'div', 'p', 'span', 'ul', 'ol', 'li']);
/* ---------- Tableaux dans l'outil Texte ---------- */
const TBL_SVG = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="16" height="14" rx="1.5"/><path d="M2 8h16M2 12.5h16M8 3v14M13 3v14"/></svg>';
// tableau collé depuis Word / Excel / Google Sheets / une page web : on garde la structure et le gras/italique, rien d'autre
function pasteTableHTML(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const KEEP = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'b', 'strong', 'i', 'em', 'u', 'br', 'p', 'ul', 'ol', 'li']);
  doc.querySelectorAll('script, style, meta, link, title, colgroup, col, xml, img, svg, iframe, object').forEach(n => n.remove());
  (function walk(n) {
    for (const c of [...n.childNodes]) {
      if (c.nodeType === 8) { c.remove(); continue; }
      if (c.nodeType !== 1) continue;
      walk(c);
      const tag = c.tagName.toLowerCase();
      // Excel/Sheets mettent le gras en style : on le convertit
      const stl = c.getAttribute('style') || '';
      if (!KEEP.has(tag)) {
        if (/font-weight:\s*(bold|[6-9]00)/i.test(stl)) { const bb = doc.createElement('b'); bb.append(...c.childNodes); c.replaceWith(bb); }
        else c.replaceWith(...c.childNodes);
        continue;
      }
      for (const a of [...c.attributes]) if (!((a.name === 'colspan' || a.name === 'rowspan') && /^\d{1,2}$/.test(a.value) && /^t[dh]$/.test(tag))) c.removeAttribute(a.name);
      if ((tag === 'td' || tag === 'th') && /font-weight:\s*(bold|[6-9]00)/i.test(stl) && tag === 'td') { const bb = doc.createElement('b'); bb.append(...c.childNodes); c.appendChild(bb); }
    }
  })(doc.body);
  // paragraphes Word dans les cellules → retours à la ligne
  doc.querySelectorAll('td p, th p').forEach(p => { const nx = p.nextElementSibling; p.replaceWith(...p.childNodes, ...(nx ? [doc.createElement('br')] : [])); });
  doc.querySelectorAll('table').forEach(t => { t.className = 'tx-tbl'; t.querySelectorAll('td, th').forEach(c => { if (!c.textContent.trim() && !c.querySelector('br')) c.innerHTML = '<br>'; }); });
  return doc.body.innerHTML.trim();
}
// texte avec tabulations (copie de tableur sans HTML) → tableau
function tsvTable(t) {
  const rows = t.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(r => r.split('\t'));
  const C = Math.max(...rows.map(r => r.length)); if (C < 2) return null;
  return '<table class="tx-tbl">' + rows.map(r => '<tr>' + Array.from({ length: C }, (_, i) => `<td>${r[i] ? esc(r[i]) : '<br>'}</td>`).join('') + '</tr>').join('') + '</table>';
}
function cleanHTML(html) {
  html = String(html || '');
  if (!/[<>]/.test(html)) html = esc(html).replace(/\n/g, '<br>');
  const doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html'); const root0 = doc.body.firstChild;
  (function walk(n) {
    for (const c of [...n.childNodes]) {
      if (c.nodeType === 3) continue;
      if (c.nodeType !== 1) { c.remove(); continue; }
      const tag = c.tagName.toLowerCase();
      if (['script', 'style', 'iframe', 'object', 'img', 'svg'].includes(tag)) { c.remove(); continue; }
      walk(c);
      if (!ALLOWED.has(tag)) { c.replaceWith(...c.childNodes); continue; }
      for (const a of [...c.attributes]) if (!(a.name === 'class' && /^hl-(gelb|blau|gruen|orange|pink)$/.test(a.value))) c.removeAttribute(a.name);
    }
  })(root0);
  return root0.innerHTML;
}

/* ---------- Export PDF (impression navigateur → « Enregistrer en PDF ») ---------- */
function exportPDF(html, title) {
  const base = location.href.replace(/[^/]*$/, '');
  const doc = `<!doctype html><html lang="${S.lang}"><head><meta charset="utf-8"><title>${esc(title || T('textExport'))}</title>
  <link rel="stylesheet" href="${base}fonts/fonts.css">
  <style>@page{size:A4;margin:18mm 20mm 20mm}body{font-family:"Atkinson Hyperlegible Next",Verdana,sans-serif;font-weight:300;font-size:12pt;line-height:1.45;color:#000;margin:0}
  header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1px solid #DADADA;padding-bottom:8px;margin-bottom:18px}
  header img{height:12mm} header span{font-size:9pt;color:#575757;font-weight:400}
  b,strong{font-weight:700}.hl{background:#F5C300}table{border-collapse:collapse;margin:.4em 0}td,th{border:1px solid #878787;padding:3pt 6pt;vertical-align:top;text-align:left}th{background:#DADADA;font-weight:700}
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
const pageName = (p, i) => p.name || `${T('page')} ${S.pages.filter((x, j) => j <= i && x.course === p.course).length || i + 1}`;

/* ---------- Onglets + catalogue des pages ----------
   Barre : pages épinglées + 3 dernières ouvertes + page active. Toutes les pages : catalogue avec recherche. */
const MAX_AUTO_PIN = 8;
const isPinned = p => p.pinned !== false;
const curCourse = () => (S.pages[S.current] || S.pages[0] || {}).course || (S.courses[0] || {}).id;
const courseById = id => S.courses.find(c => c.id === id);
const courseName = c => c ? (c.name || T('defaultCourse')) : '';
function newPage(name, course) {
  course = course || curCourse();
  const p = { id: uid(), name: name || '', bg: 'blanc', widgets: [], created: Date.now(), course };
  p.pinned = S.pages.filter(x => x.course === course && isPinned(x)).length < MAX_AUTO_PIN;
  S.pages.push(p); return p;
}
function tabVisible(p, i) { return isPinned(p) || i === S.current || (S.recent || []).includes(p.id); }
const CAT_SVG = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="currentColor"><rect x="1" y="1" width="7.5" height="7.5" rx="1.5"/><rect x="11.5" y="1" width="7.5" height="7.5" rx="1.5"/><rect x="1" y="11.5" width="7.5" height="7.5" rx="1.5"/><rect x="11.5" y="11.5" width="7.5" height="7.5" rx="1.5"/></svg>';
const SIDE_SVG = '<svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="2" y="3" width="16" height="14" rx="2.5"/><path d="M7.5 3v14"/></svg>';
/* volet des pages à gauche : épinglées (ordre des pages) puis les autres (ouvertes récemment), filtre rapide */
function renderTabs() {
  const tabs = $('#tabs'), qIn = $('#sideQ');
  const words = fold(qIn.value).split(/\s+/).filter(Boolean);
  const match = (p, i) => { if (!words.length) return true; const t = pageText(p) + ' ' + fold(pageName(p, i)); return words.every(w => t.includes(w)); };
  const cc = curCourse(), mine = S.pages.map((p, i) => ({ p, i })).filter(({ p }) => p.course === cc);
  const all = mine.filter(({ p, i }) => match(p, i));
  const elsewhere = words.length ? S.pages.map((p, i) => ({ p, i })).filter(({ p, i }) => p.course !== cc && match(p, i)) : [];
  const pin = all.filter(({ p }) => isPinned(p)), other = all.filter(({ p }) => !isPinned(p)).sort((a, b) => (b.p.opened || 0) - (a.p.opened || 0));
  const row = ({ p, i }) => `<div class="side-row"><button class="tab ${isPinned(p) ? '' : 'tab--tmp'}" aria-current="${i === S.current ? 'page' : 'false'}" data-i="${i}" title="${T('tabHint')}">${esc(pageName(p, i))}${p.course !== cc ? `<small class="side-crs">${esc(courseName(courseById(p.course)))}</small>` : ''}</button>`
    + `<button class="side-pin" data-pin="${i}" aria-pressed="${isPinned(p)}" title="${isPinned(p) ? T('unpinTab') : T('pinTab')}" aria-label="${isPinned(p) ? T('unpinTab') : T('pinTab')} : ${esc(pageName(p, i))}">${isPinned(p) ? '★' : '☆'}</button></div>`;
  tabs.innerHTML = (pin.length ? `<h3 class="side-h">${T('pinnedPages')}</h3>${pin.map(row).join('')}` : '')
    + (other.length ? `<h3 class="side-h">${T('otherPages')}</h3>${other.map(row).join('')}` : '')
    + (elsewhere.length ? `<h3 class="side-h">${T('otherCourses')}</h3>${elsewhere.map(row).join('')}` : '')
    + (all.length || elsewhere.length ? '' : `<p class="lbl-s side-none">${T('noPageFound')}</p>`);
  $('#sideTitle').textContent = `${T('pagesTitle')} (${mine.length})`;
  const sc = $('#sideCourse'); sc.setAttribute('aria-label', T('course'));
  sc.innerHTML = S.courses.map(c => `<option value="${c.id}" ${c.id === cc ? 'selected' : ''}>${esc(courseName(c))}</option>`).join('') + `<option value="__new">+ ${T('newCourse')}</option>`;
  const cur = tabs.querySelector('[aria-current=page]'); if (cur) cur.scrollIntoView({ block: 'nearest' });
}
function applySide() {
  document.body.classList.toggle('side-hidden', !!S.sideHidden);
  const b = $('#btnSide'); b.innerHTML = `${SIDE_SVG}<span class="lbl">${T('pagesTitle')}</span>`; b.title = T('toggleSide'); b.setAttribute('aria-expanded', String(!S.sideHidden));
  $('#sideHide').innerHTML = '«'; $('#sideHide').title = T('hideSide'); $('#sideHide').setAttribute('aria-label', T('hideSide'));
  $('#sideAdd').textContent = '+ ' + T('addPage'); $('#sideCat').innerHTML = `${CAT_SVG}<span>${T('allPages')}</span>`;
  $('#sideQ').placeholder = T('filterPages'); $('#sideQ').setAttribute('aria-label', T('filterPages')); $('#side').setAttribute('aria-label', T('pagesTitle'));
}
function setSide(hidden) { S.sideHidden = hidden; save(); applySide(); }
// le volet passe par-dessus le tableau : un clic ailleurs le referme
document.addEventListener('pointerdown', e => { if (S.sideHidden || HOME || e.target.closest('#side, #btnSide, dialog')) return; setSide(true); });
$('#btnSide').onclick = () => setSide(!S.sideHidden);
$('#sideHide').onclick = () => setSide(true);
$('#sideQ').addEventListener('input', () => renderTabs());
$('#sideCourse').addEventListener('change', e => { const v = e.target.value; if (v === '__new') { renderTabs(); editCourse(null); } else { $('#sideQ').value = ''; openCourse(v); } });

/* ---------- Accueil + cours ---------- */
const HOME_SVG = '<svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><path d="M3 9.5 10 3l7 6.5"/><path d="M5 8v9h10V8"/></svg>';
function openCourse(id) {
  let L = S.pages.map((p, i) => ({ p, i })).filter(({ p }) => p.course === id);
  if (!L.length) { newPage('', id); L = [{ p: S.pages[S.pages.length - 1], i: S.pages.length - 1 }]; }
  L.sort((a, b) => (b.p.opened || 0) - (a.p.opened || 0));
  S.current = L[0].i; HOME = false; save(); applyHome(); renderBoard(); renderTabs();
}
function goHome() {
  if ($('#btnProf').getAttribute('aria-pressed') === 'true') $('#btnProf').click();
  closeDlg(); HOME = true; applyHome();
}
function applyHome() {
  document.body.classList.toggle('home-on', HOME);
  $('#home').hidden = !HOME;
  const b = $('#btnHome'); b.innerHTML = `${HOME_SVG}<span class="lbl">${T('home')}</span>`; b.title = T('home'); b.setAttribute('aria-pressed', String(HOME));
  if (HOME) renderHome();
}
function renderHome() {
  const now = new Date(), fmtD = ts => ts ? new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) : '';
  const cards = S.courses.map(c => {
    const P = S.pages.filter(p => p.course === c.id), last = Math.max(0, ...P.map(p => p.opened || 0)), cls = classById(c.classId);
    return `<div class="crs" style="--c:var(--d-${COURSE_COLORS.includes(c.color) ? c.color : 'rot'})"><button class="crs-open" data-open="${c.id}"><span class="crs-band"></span>
      <b class="crs-n">${esc(courseName(c))}</b><span class="lbl-s">${cls ? esc(cls.name) + ' · ' : ''}${T('nPages').replace('{n}', P.length)}</span>
      <span class="lbl-s">${last ? T('lastUsed') + ' ' + fmtD(last) : '&nbsp;'}</span></button>
      <button class="crs-edit" data-edit="${c.id}" title="${T('editCourse')}" aria-label="${T('editCourse')} : ${esc(courseName(c))}">✎</button></div>`;
  }).join('');
  $('#home').innerHTML = `<div class="home-in">
    <div class="home-hero"><div><h1>${T(now.getHours() >= 18 ? 'homeEvening' : 'homeHello')}</h1>
      <p class="home-date">${now.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
      <div class="home-quick">
        <button class="home-q" data-h="prof"><span class="home-ic">${ICON('graduation-cap')}</span><span><b>${T('profSpace')}</b><span class="lbl-s">${T('homeProfD')}</span></span></button>
        <button class="home-q" data-h="classes"><span class="home-ic">${ICON('class-lesson')}</span><span><b>${T('classes')}</b><span class="lbl-s">${T('homeClassesD')}</span></span></button>
      </div></div>
    <div class="home-h"><h2>${T('myCourses')}</h2><button class="btn" data-h="newCourse">+ ${T('newCourse')}</button></div>
    <div class="home-grid">${cards}</div>
    <p class="lbl-s home-hint">${T('homeHint')}</p>
    <div class="home-foot"><div class="seg-top seg-side" role="group" aria-label="Langue / Sprache / Language / Lingua">${['fr', 'de', 'en', 'it'].map(l => `<button type="button" data-hlang="${l}" aria-pressed="${l === S.lang}">${l.toUpperCase()}</button>`).join('')}</div></div></div>`;
}
$('#home').addEventListener('click', e => {
  const o = e.target.closest('[data-open]'); if (o) { openCourse(o.dataset.open); return; }
  const ed = e.target.closest('[data-edit]'); if (ed) { editCourse(ed.dataset.edit); return; }
  const hl = e.target.closest('[data-hlang]'); if (hl) { setLang(hl.dataset.hlang); return; }
  const a = e.target.closest('[data-h]'); if (!a) return;
  if (a.dataset.h === 'prof') { HOME = false; applyHome(); renderBoard(); renderTabs(); $('#btnProf').click(); }
  if (a.dataset.h === 'classes') openClasses();
  if (a.dataset.h === 'newCourse') editCourse(null);
});
$('#btnHome').onclick = () => { if (HOME) { HOME = false; applyHome(); renderBoard(); renderTabs(); } else goHome(); };
$('#btnProf').addEventListener('click', () => { if (HOME) { HOME = false; applyHome(); renderBoard(); renderTabs(); } });
function editCourse(id) {
  const c = id ? courseById(id) : null, n = c ? S.pages.filter(p => p.course === c.id).length : 0;
  let color = c ? c.color || 'rot' : COURSE_COLORS[S.courses.length % COURSE_COLORS.length];
  openDlg(`<h2>${c ? T('editCourse') : T('newCourse')}</h2>
    <label class="field"><span>${T('courseName')}</span><input class="inp" id="crsName" value="${esc(c ? c.name : '')}" placeholder="${c ? esc(courseName(c)) : T('courseNamePh')}"></label>
    <div class="field"><span>${T('courseColor')}</span><div class="crs-cols" role="group" aria-label="${T('courseColor')}">${COURSE_COLORS.map(k => `<button type="button" class="crs-col" data-col="${k}" aria-pressed="${k === color}" style="background:var(--d-${k})" aria-label="${k}"></button>`).join('')}</div></div>
    <label class="field"><span>${T('courseClass')}</span><select class="inp" id="crsCls"><option value="">${T('noneOpt')}</option>${S.classes.map(k => `<option value="${k.id}" ${c && c.classId === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></label>
    <div class="row row--end">${c && S.courses.length > 1 ? `<button class="btn btn--black" data-c="del">${T('deleteCourse')}</button><span style="flex:1"></span>` : ''}<button class="btn btn--ghost" data-act="closeDlg">${T('cancel')}</button><button class="btn" data-c="ok">${c ? T('save') : T('createCourse')}</button></div>`, body => {
    const inp = $('#crsName', body); inp.focus();
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('[data-c=ok]', body).click(); } };
    body.onclick = async e => {
      const col = e.target.closest('[data-col]'); if (col) { color = col.dataset.col; body.querySelectorAll('[data-col]').forEach(b => b.setAttribute('aria-pressed', b === col)); return; }
      const b = e.target.closest('[data-c]'); if (!b) return;
      if (b.dataset.c === 'ok') {
        const name = inp.value.trim(), classId = $('#crsCls', body).value;
        if (c) { c.name = name; c.color = color; c.classId = classId; delete c.auto; save(); closeDlg(); renderTabs(); if (HOME) renderHome(); return; }
        const nc = { id: uid(), name: name || T('newCourse'), color, classId, created: Date.now() }; S.courses.push(nc); closeDlg(); openCourse(nc.id); return;
      }
      if (b.dataset.c === 'del') {
        closeDlg(); if (!(await confirmBox(T('deleteCourseQ').replace('{n}', esc(courseName(c))).replace('{p}', n), T('deleteCourse')))) return;
        const curId = (S.pages[S.current] || {}).id;
        S.pages = S.pages.filter(p => p.course !== c.id); S.courses = S.courses.filter(x => x !== c);
        if (!S.pages.length) newPage('', S.courses[0].id);
        S.current = Math.max(0, S.pages.findIndex(p => p.id === curId)); save(); renderTabs(); if (HOME) renderHome(); else renderBoard();
      }
    };
  });
}
$('#side').addEventListener('click', e => {
  const t = e.target.closest('[data-i]');
  if (t) { const i = +t.dataset.i; if (i === S.current) pageMenu(i); else { S.current = i; save(); renderBoard(); renderTabs(); setSide(true); } return; }
  const pn = e.target.closest('[data-pin]'); if (pn) { const p = S.pages[+pn.dataset.pin]; p.pinned = !isPinned(p); save(); renderTabs(); return; }
  if (e.target.closest('[data-act=catalog]')) { openCatalog(); return; }
  if (e.target.closest('[data-act=addPage]')) { newPage(); S.current = S.pages.length - 1; $('#sideQ').value = ''; save(); renderBoard(); renderTabs(); }
});
const fold = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function pageText(p) {
  const out = [p.name];
  p.widgets.forEach(w => { const st = w.state || {}; out.push(st.title, st.text, st.label, st.html && st.html.replace(/<[^>]+>/g, ' '));
    (st.items || []).forEach(it => out.push(it.t)); });
  return fold(out.filter(Boolean).join(' '));
}
function openCatalog() {
  let q = '', sort = S.catSort || 'recent';
  const fmtD = ts => ts ? new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  function list() {
    const words = fold(q).split(/\s+/).filter(Boolean);
    let L = S.pages.map((p, i) => ({ p, i })).filter(({ p }) => { if (!words.length) return true; const t = pageText(p); return words.every(w => t.includes(w)); });
    if (sort === 'recent') L.sort((a, b) => (b.p.opened || 0) - (a.p.opened || 0));
    if (sort === 'name') L.sort((a, b) => pageName(a.p, a.i).localeCompare(pageName(b.p, b.i), locale(), { numeric: true }));
    if (sort === 'nameDesc') L.sort((a, b) => pageName(b.p, b.i).localeCompare(pageName(a.p, a.i), locale(), { numeric: true }));
    return L.length ? L.map(({ p, i }) => `<div class="cat-row ${i === S.current ? 'is-cur' : ''}">
      <button class="cat-pin" data-pin="${i}" aria-pressed="${isPinned(p)}" title="${T('pinTab')}" aria-label="${T('pinTab')} : ${esc(pageName(p, i))}">${isPinned(p) ? '★' : '☆'}</button>
      <button class="cat-open" data-open="${i}"><b>${esc(pageName(p, i))}</b><span class="lbl-s">${esc(courseName(courseById(p.course)))} · ${T('nTools').replace('{n}', p.widgets.length)} · ${T('openedOn')} ${fmtD(p.opened)}</span>
        <span class="cat-ic">${[...new Set(p.widgets.map(w => w.type))].slice(0, 8).map(ty => WIDGETS[ty] ? ICON(WIDGETS[ty].icon) : '').join('')}</span></button>
      <button class="btn btn--ghost btn--s" data-dup="${i}">${T('duplicate')}</button>
      <button class="w-x" data-del="${i}" ${S.pages.length < 2 ? 'disabled' : ''} title="${T('deletePage')}" aria-label="${T('deletePage')} ${esc(pageName(p, i))}">×</button></div>`).join('')
      : `<p class="lbl-s">${T('noPageFound')}</p>`;
  }
  const go = i => { S.current = i; closeDlg(); save(); renderBoard(); renderTabs(); };
  openDlg(`<h2>${T('allPages')} (${S.pages.length})</h2>
    <div class="row"><input class="inp" type="search" id="catQ" placeholder="${T('pageSearchPh')}" aria-label="${T('search')}" style="flex:1;min-width:180px">
      <select class="inp" id="catSort" aria-label="${T('sortBy')}">${['recent', 'name', 'nameDesc', 'order'].map(k => `<option value="${k}" ${k === sort ? 'selected' : ''}>${T('sort_' + k)}</option>`).join('')}</select>
      <button class="btn btn--ghost" data-act="catTpl">${T('fromTemplate')}</button><button class="btn" data-act="catNew">+ ${T('addPage')}</button></div>
    <p class="lbl-s" style="margin:0">${T('catHint')}</p>
    <div class="cat-list" id="catList">${list()}</div>
    <div class="row row--end"><button class="btn btn--ghost" data-act="closeDlg">${T('close')}</button></div>`, body => {
    const inp = $('#catQ', body), box = $('#catList', body); inp.value = q; inp.focus();
    const refresh = () => { box.innerHTML = list(); };
    inp.oninput = () => { q = inp.value; refresh(); };
    inp.onkeydown = e => { if (e.key === 'Enter') { const f = $('[data-open]', box); if (f) go(+f.dataset.open); } };
    $('#catSort', body).onchange = e => { sort = S.catSort = e.target.value; save(); refresh(); };
    body.onclick = async e => {
      const t = e.target;
      const o = t.closest('[data-open]'); if (o) return go(+o.dataset.open);
      const pn = t.closest('[data-pin]'); if (pn) { const p = S.pages[+pn.dataset.pin]; p.pinned = !isPinned(p); save(); renderTabs(); refresh(); return; }
      const d = t.closest('[data-dup]'); if (d) { const i = +d.dataset.dup, p = S.pages[i]; const c = JSON.parse(JSON.stringify(p)); c.id = uid(); c.name = (p.name || pageName(p, i)) + ' (2)'; c.opened = Date.now(); c.widgets.forEach(w => w.id = uid()); S.pages.splice(i + 1, 0, c); if (S.current > i) S.current++; save(); renderTabs(); refresh(); return; }
      const x = t.closest('[data-del]'); if (x) { const i = +x.dataset.del, p = S.pages[i];
        if (await confirmBox(T('deletePageQ').replace('{p}', esc(pageName(p, i))), T('deletePage'))) { S.pages.splice(i, 1); if (S.current >= i) S.current = Math.max(0, S.current - 1); save(); renderBoard(); renderTabs(); }
        openCatalog(); return; }
      if (t.closest('[data-act=catTpl]')) { openTemplates(); return; }
      if (t.closest('[data-act=catNew]')) { const p = newPage(inp.value.trim()); go(S.pages.indexOf(p)); }
    };
  }, true);
}

function unmountAll() { mounted.forEach(m => { try { m.cleanup && m.cleanup(); } catch (e) { } m.el.remove(); }); mounted.clear(); }
function renderBoard() {
  unmountAll();
  const p = page();
  p.opened = Date.now();
  S.recent = [p.id, ...(S.recent || []).filter(id => id !== p.id && S.pages.some(x => x.id === id))].slice(0, 4);
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
  $('#dock').innerHTML = `<button class="tool tool--hide" data-act="hideDock" title="${T('hideDock')}">${DOCK_SVG(false)}<span>${T('hideDockShort')}</span></button><span class="dock-sep"></span>` + ORDER.map(k => {
    const d = WIDGETS[k];
    const vis = d.icon ? ICON(d.icon) : `<span class="glyph" aria-hidden="true">${d.glyph}</span>`;
    return `<button class="tool" data-add="${k}">${vis}<span>${T('w_' + k)}</span></button>`;
  }).join('') + `<span class="sp"></span><span class="dock-sep"></span>
    <div class="bgpick" role="group" aria-label="${T('background')}"><span class="lbl-s">${T('background')}</span>${BGS.map(([k, c]) => `<button class="sw" style="background:${c}" data-bg="${k}" aria-pressed="${p.bg === k}" aria-label="${T('bg_' + k)}" title="${T('bg_' + k)}"></button>`).join('')}
    <label class="btn btn--s btn--ghost" title="${T('bgImageHint')}" ${p.bg === 'image' ? 'style="background:var(--d-gris1)"' : ''}>${T('bg_image')}<input type="file" accept="image/*" hidden data-role="bgimg"></label></div>`;
}
/* Barre d'outils masquable : plus de place pour le tableau ; un petit bouton la fait revenir */
const DOCK_SVG = up => `<svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${up ? 'M4 13l6-6 6 6' : 'M4 7l6 6 6-6'}"/></svg>`;
function applyDock() {
  document.body.classList.toggle('dock-hidden', !!S.dockHidden);
  let b = $('#dockShow');
  if (!b) { b = document.createElement('button'); b.id = 'dockShow'; b.className = 'dock-show'; b.onclick = () => { S.dockHidden = false; save(); applyDock(); }; document.body.appendChild(b); }
  b.innerHTML = `${DOCK_SVG(true)}<span>${T('showDock')}</span>`; b.title = T('showDock'); b.hidden = !S.dockHidden;
}
$('#dock').addEventListener('click', e => {
  const a = e.target.closest('[data-add]'); if (a) { addWidget(a.dataset.add); return; }
  if (e.target.closest('[data-act=hideDock]')) { S.dockHidden = true; save(); applyDock(); return; }
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
function openDlg(html, onReady, wide) {
  dlg.classList.toggle('dlg--wide', !!wide); $('#dlgBody').innerHTML = html; if (!dlg.open) dlg.showModal(); onReady && onReady($('#dlgBody'));
}
function closeDlg() { if (dlg.open) dlg.close(); }
dlg.addEventListener('click', e => { if (e.target === dlg) closeDlg(); if (e.target.closest('[data-act=closeDlg]')) closeDlg(); });
function confirmBox(msg, okLabel) {
  return new Promise(res => {
    openDlg(`<h2>${T('confirm')}</h2><p>${msg}</p><div class="row row--end"><button class="btn btn--ghost" data-r="0">${T('cancel')}</button><button class="btn" data-r="1">${okLabel || T('ok')}</button></div>`, body => {
      body.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { dlg.removeEventListener('close', onClose); closeDlg(); res(b.dataset.r === '1'); });
    });
    // un « close » en attente d'un dialogue précédent ne doit pas répondre « non » à la place de l'utilisateur
    function onClose() { if (dlg.open) return; dlg.removeEventListener('close', onClose); res(false); }
    dlg.addEventListener('close', onClose);
  });
}

function pageMenu(i) {
  const p = S.pages[i];
  const sib = d => { for (let j = i + d; j >= 0 && j < S.pages.length; j += d) if (S.pages[j].course === p.course) return j; return -1; };
  openDlg(`<h2>${T('pageSettings')}</h2>
    <label class="field"><span>${T('pageName')}</span><input class="inp" id="pgName" value="${esc(p.name)}" placeholder="${esc(pageName(p, i))}"></label>
    <label class="field"><span>${T('course')}</span><select class="inp" id="pgCourse">${S.courses.map(c => `<option value="${c.id}" ${c.id === p.course ? 'selected' : ''}>${esc(courseName(c))}</option>`).join('')}</select></label>
    <div class="row">
      <button class="btn btn--ghost btn--s" data-m="left" ${sib(-1) < 0 ? 'disabled' : ''}>↑ ${T('moveUp')}</button>
      <button class="btn btn--ghost btn--s" data-m="right" ${sib(1) < 0 ? 'disabled' : ''}>↓ ${T('moveDown')}</button>
      <button class="btn btn--ghost btn--s" data-m="pin">${isPinned(p) ? '★ ' + T('unpinTab') : '☆ ' + T('pinTab')}</button>
      <button class="btn btn--ghost btn--s" data-m="dup">${T('duplicate')}</button>
      <button class="btn btn--ghost btn--s" data-m="tpl" ${p.widgets.length ? '' : 'disabled'}>${T('saveTpl')}</button>
      <button class="btn btn--ghost btn--s" data-m="clear">${T('clearPage')}</button>
      <button class="btn btn--black btn--s" data-m="del" ${S.pages.length < 2 ? 'disabled' : ''}>${T('deletePage')}</button>
    </div>
    <div class="row row--end"><button class="btn" data-m="ok">${T('ok')}</button></div>`, body => {
    const inp = $('#pgName', body); inp.focus(); inp.select();
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('[data-m=ok]', body).click(); } };
    body.onclick = async e => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      p.name = inp.value.trim(); p.course = $('#pgCourse', body).value || p.course;
      const m = b.dataset.m;
      if (m === 'left' || m === 'right') { const j = sib(m === 'left' ? -1 : 1); if (j >= 0) { [S.pages[i], S.pages[j]] = [S.pages[j], S.pages[i]]; S.current = j; } }
      if (m === 'tpl') { save(); renderTabs(); saveAsTemplate(i); return; }
      if (m === 'pin') p.pinned = !isPinned(p);
      if (m === 'dup') { const c = JSON.parse(JSON.stringify(p)); c.id = uid(); c.name = (p.name || pageName(p, i)) + ' (2)'; c.widgets.forEach(w => w.id = uid()); S.pages.splice(i + 1, 0, c); S.current = i + 1; }
      if (m === 'clear') { closeDlg(); if (await confirmBox(T('clearPageQ'))) { p.widgets = []; } }
      if (m === 'del') { closeDlg(); if (await confirmBox(T('deletePageQ').replace('{p}', esc(pageName(p, i))), T('deletePage'))) { S.pages.splice(i, 1); S.current = Math.max(0, Math.min(S.current, S.pages.length - 1)); } }
      closeDlg(); save(); renderTabs(); renderBoard();
    };
  });
}

/* ---------- Modèles de pages : fournis + enregistrés par chaque prof ----------
   Positions en fractions du tableau (x, y, w, h entre 0 et 1) pour s'adapter à tous les écrans. */
const BUILTIN_TPL = [
  { id: 'b-input', name: 'tpl_input', desc: 'tpl_input_d', widgets: [
    ['plan', .02, .03, .30, .62, () => ({ title: T('tpl_input'), mode: 'check', items: [{ t: T('tpl_i1'), d: false, icon: 'ear-hearing' }, { t: T('tpl_i2'), d: false, icon: 'collaborations-idea' }, { t: T('tpl_i3'), d: false, icon: 'chat-two-bubbles-oval' }, { t: T('tpl_i4'), d: false, icon: 'book-reading' }] })],
    ['timer', .34, .03, .30, .40, () => ({ dur: 600, remaining: 600 })],
    ['work', .66, .03, .32, .40, () => ({ vol: 0, soc: 0, act: 0 })],
    ['homework', .34, .47, .40, .48, () => ({})],
    ['clock', .76, .47, .22, .30, () => ({})]] },
  { id: 'b-groups', name: 'tpl_groups', desc: 'tpl_groups_d', widgets: [
    ['groups', .02, .03, .50, .70, () => ({})],
    ['timer', .54, .03, .26, .40, () => ({ dur: 1200, remaining: 1200 })],
    ['light', .82, .03, .16, .60, () => ({ on: 2 })],
    ['work', .54, .47, .26, .40, () => ({ vol: 1, soc: 2, act: null })]] },
  { id: 'b-start', name: 'tpl_start', desc: 'tpl_start_d', widgets: [
    ['clock', .02, .03, .26, .34, () => ({})],
    ['schedule', .02, .41, .34, .54, () => ({})],
    ['plan', .38, .03, .30, .62, () => ({ title: T('tpl_today'), mode: 'list', items: [] })],
    ['homework', .70, .03, .28, .50, () => ({})],
    ['random', .70, .57, .28, .38, () => ({})]] },
  { id: 'b-vocab', name: 'tpl_vocab', desc: 'tpl_vocab_d', widgets: [
    ['flash', .02, .03, .48, .62, () => ({})],
    ['random', .52, .03, .30, .45, () => ({ classId: '__list' })],
    ['timer', .52, .52, .30, .40, () => ({ dur: 300, remaining: 300 })]] },
  { id: 'b-test', name: 'tpl_test', desc: 'tpl_test_d', widgets: [
    ['clock', .02, .03, .30, .40, () => ({})],
    ['timer', .34, .03, .36, .50, () => ({ dur: 2700, remaining: 2700 })],
    ['work', .72, .03, .26, .40, () => ({ vol: 0, soc: 0, act: 2 })],
    ['light', .02, .47, .14, .48, () => ({ on: 0 })],
    ['text', .18, .57, .52, .38, () => ({})]] }];
function boardBox() { const r = board.getBoundingClientRect(); return { W: Math.max(600, r.width), H: Math.max(400, r.height) }; }
function pageFromTemplate(tpl) {
  const { W, H } = boardBox();
  const p = newPage(tpl.builtin ? T(tpl.name) : tpl.name); p.bg = tpl.bg || 'blanc'; if (tpl.bgImg) p.bgImg = tpl.bgImg;
  p.widgets = tpl.widgets.filter(w => WIDGETS[w[0]]).map(([type, x, y, w, h, st]) => {
    const wd = { id: uid(), type, x: Math.round(x * W), y: Math.round(y * H), w: Math.round(w * W), h: Math.round(h * H), z: ++S.z,
      state: Object.assign(WIDGETS[type].init(), typeof st === 'function' ? st() : JSON.parse(JSON.stringify(st || {}))) };
    clampBox(wd); return wd;
  });
  return p;
}
function saveAsTemplate(i) {
  const p = S.pages[i], { W, H } = boardBox();
  openDlg(`<h2>${T('saveTpl')}</h2>
    <label class="field"><span>${T('tplName')}</span><input class="inp" id="tplName" value="${esc(p.name || '')}" required></label>
    <p class="lbl-s" style="margin:0">${T('saveTplHint')}</p>
    <div class="row row--end"><button class="btn btn--ghost" data-act="closeDlg">${T('cancel')}</button><button class="btn" id="tplOk">${T('save')}</button></div>`, body => {
    const inp = $('#tplName', body); inp.focus(); inp.select();
    const ok = () => {
      const name = inp.value.trim() || pageName(p, i);
      // l'état des widgets est copié, sauf les résultats du moment (tirages, votes, chronos en cours)
      const reset = { random: { drawn: [], last: null }, poll: { counts: [0, 0, 0, 0] }, timer: { endAt: null }, stopwatch: { start: null, acc: 0, laps: [] }, flash: { pos: 0, known: [], flipped: false } };
      const widgets = p.widgets.map(w => [w.type, +(w.x / W).toFixed(3), +(w.y / H).toFixed(3), +(w.w / W).toFixed(3), +(w.h / H).toFixed(3), Object.assign(JSON.parse(JSON.stringify(w.state || {})), reset[w.type] || {})]);
      S.templates = S.templates || []; S.templates.push({ id: uid(), name, bg: p.bg, bgImg: p.bg === 'image' ? p.bgImg : undefined, widgets, created: Date.now() });
      if (!save(true)) { S.templates.pop(); alertBox(T('storageFull')); return; }
      closeDlg(); toast(T('tplSaved').replace('{n}', esc(name)));
    };
    $('#tplOk', body).onclick = ok; inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } };
  });
}
function openTemplates() {
  const icons = t => [...new Set(t.widgets.map(w => w[0]))].filter(ty => WIDGETS[ty]).slice(0, 7).map(ty => WIDGETS[ty].icon ? ICON(WIDGETS[ty].icon) : `<span class="glyph">${WIDGETS[ty].glyph}</span>`).join('');
  const card = (t, mine) => `<div class="tpl-card"><button class="tpl-use" data-tpl="${t.id}"><b>${esc(mine ? t.name : T(t.name))}</b><span class="lbl-s">${mine ? T('nTools').replace('{n}', t.widgets.length) : T(t.desc)}</span><span class="cat-ic">${icons(t)}</span></button>
    ${mine ? `<button class="w-x" data-tpldel="${t.id}" title="${T('delete')}" aria-label="${T('delete')} ${esc(t.name)}">×</button>` : ''}</div>`;
  const mine = S.templates || [];
  openDlg(`<h2>${T('templates')}</h2>
    <p class="lbl-s" style="margin:0">${T('templatesHint')}</p>
    <h3 class="tpl-h">${T('tplBuiltin')}</h3><div class="tpl-grid">${BUILTIN_TPL.map(t => card(t, false)).join('')}</div>
    <h3 class="tpl-h">${T('tplMine')}</h3>${mine.length ? `<div class="tpl-grid">${mine.map(t => card(t, true)).join('')}</div>` : `<p class="lbl-s" style="margin:0">${T('tplMineEmpty')}</p>`}
    <div class="row row--end"><button class="btn btn--ghost" data-act="closeDlg">${T('close')}</button></div>`, body => {
    body.onclick = async e => {
      const u = e.target.closest('[data-tpl]');
      if (u) { const id = u.dataset.tpl, b0 = BUILTIN_TPL.find(t => t.id === id), t = b0 ? Object.assign({ builtin: true }, b0) : mine.find(x => x.id === id); if (!t) return;
        closeDlg(); pageFromTemplate(t); S.current = S.pages.length - 1; save(); renderBoard(); renderTabs(); return; }
      const d = e.target.closest('[data-tpldel]');
      if (d) { const t = mine.find(x => x.id === d.dataset.tpldel); if (t && await confirmBox(T('tplDelQ').replace('{n}', esc(t.name)), T('delete'))) { S.templates = S.templates.filter(x => x !== t); save(); } openTemplates(); }
    };
  }, true);
}

/* ---------- Rappel de sauvegarde (toutes les données vivent dans ce navigateur) ---------- */
const BACKUP_DAYS = 14, DAY = 864e5;
function toast(html, actions) {
  let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.innerHTML = `<span>${html}</span>${(actions || []).map((a, i) => `<button class="btn btn--s ${i ? 'btn--ghost' : ''}" data-ti="${i}">${a[0]}</button>`).join('')}${actions ? '' : ''}`;
  t.hidden = false; clearTimeout(t._h);
  t.onclick = e => { const b = e.target.closest('[data-ti]'); if (b) { t.hidden = true; actions[+b.dataset.ti][1](); } };
  if (!actions) t._h = setTimeout(() => { t.hidden = true; }, 3500);
}
function hasData() { return S.classes.length > 0 || S.pages.some(p => p.widgets.length) || !!LS.get('didac-tableau-vault', null); }
function checkBackup() {
  const now = Date.now(); S.since = S.since || now;
  if (!hasData() || (S.backupSnooze || 0) > now) return;
  const last = S.lastBackup || 0, ref = last || S.since;
  if (now - ref < BACKUP_DAYS * DAY) return;
  const days = Math.floor((now - (last || S.since)) / DAY);
  toast(last ? T('backupOld').replace('{n}', days) : T('backupNever'),
    [[T('backupNow'), () => exportBoard()], [T('later'), () => { S.backupSnooze = now + 7 * DAY; save(); }]]);
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
  S.lastBackup = Date.now(); S.backupSnooze = 0; save();
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
      S = d.state; S.classes = S.classes || []; S.presence = S.presence || {}; ensureCourses();
      if (d.vault) LS.set('didac-tableau-vault', d.vault);
      if (d.docs && window.DidacDocs) await window.DidacDocs.importAll(d.docs);
      save(true); applyStatic(); renderTabs(); renderBoard();
      window.dispatchEvent(new Event('didac-vault-replaced'));
    } catch (e) { openDlg(`<h2>${T('error')}</h2><p>${T('importErr')}</p><div class="row row--end"><button class="btn" data-act="closeDlg">${T('ok')}</button></div>`); }
  };
  r.readAsText(file);
}

/* ---------- Bandeau ---------- */
// EN et IT sont chargés seulement quand on les choisit (le site reste léger)
function loadLang(l, done) {
  if (window.DIDAC_I18N[l]) return done();
  const sc = document.createElement('script'); sc.src = `i18n-${l}.js?v=${window.DIDAC_V || ''}`; sc.onload = done; sc.onerror = done; document.head.appendChild(sc);
}
function setLang(l) { loadLang(l, () => { S.lang = l; save(); applyStatic(); renderTabs(); renderBoard(); window.dispatchEvent(new Event('didac-lang')); }); }
document.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => setLang(b.dataset.lang));
if (!window.DIDAC_I18N[S.lang]) setLang(S.lang);
$('#btnClasses').onclick = () => openClasses();
$('#btnFull').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); };
document.addEventListener('fullscreenchange', applyStatic);
let rzT; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { page().widgets.forEach(wd => { clampBox(wd); const m = mounted.get(wd.id); if (m) placeEl(m.el, wd); }); }, 150); });

/* ---------- API partagée avec prof.js ---------- */
window.DidacApp = {
  T, esc, cleanHTML, uid, h, $, LS, ICON, pad, todayISO, locale, download, exportPDF, openDlg, closeDlg, confirmBox, openClasses,
  get state() { return S; }, classById, save, addWidget, iconPicker, exportBoard,
  addPage(name) { const p = newPage(name); p.pinned = true; save(); renderTabs(); return p.id; },
  goPage(id) { const i = S.pages.findIndex(p => p.id === id); if (i < 0) return; S.current = i; HOME = false; applyHome(); save(); renderTabs(); renderBoard(); },
  pageLabel(p, j) { return (S.courses.length > 1 ? courseName(courseById(p.course)) + ' · ' : '') + pageName(p, j); }
};

S.sideHidden = true; // volet fermé à l'ouverture
applyStatic(); renderTabs(); renderBoard(); applyDock();
setTimeout(checkBackup, 4000);
$('#emptyTpl').addEventListener('click', openTemplates);
})();
