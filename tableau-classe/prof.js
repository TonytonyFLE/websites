/* =====================================================================
   DIDAC · TABLEAU DE CLASSE — espace prof (agenda, absences, notes, checklist)
   Protection : mot de passe → PBKDF2-SHA256 (310 000 itérations) → clé AES-GCM 256.
   Les données ne sont jamais écrites en clair : seul le coffre chiffré est
   stocké dans le navigateur. La clé reste en mémoire et disparaît au
   verrouillage (bouton, 20 min d'inactivité ou fermeture de la page).
   ===================================================================== */
(function () {
'use strict';
const A = window.DidacApp;
const { T, esc, uid, $, LS, ICON, todayISO, locale } = A;
const VKEY = 'didac-tableau-vault';
const IDLE_MIN = 20;

/* ---------- Chiffrement ---------- */
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pw, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
let key = null, salt = null, iter = 310000, D = null, idleT = null, saveT = null;

async function persist() {
  if (!key || !D) return;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(D)));
  LS.set(VKEY, { v: 1, kdf: 'PBKDF2-SHA256', iter, salt: b64(salt), iv: b64(iv), ct: b64(ct), saved: new Date().toISOString() });
}
// Copie non sensible de l'emploi du temps (créneaux, matière, classe, salle) pour l'horaire auto du tableau,
// qui doit marcher sans mot de passe. Aucune donnée d'élève.
function mirrorSchedule() {
  if (!D || !D.timetable) return;
  const cells = {};
  Object.entries(D.timetable.cells).forEach(([k, c]) => { cells[k] = { subject: c.subject || '', cls: (A.classById(c.classId) || {}).name || '', room: c.room || '', color: c.color || '' }; });
  const next = { slots: D.timetable.slots, cells }, S = A.state;
  if (JSON.stringify(S.schedule) === JSON.stringify(next)) return;
  S.schedule = next; A.save(); window.dispatchEvent(new Event('didac-schedule'));
}
function saveSoon() { clearTimeout(saveT); saveT = setTimeout(() => { persist(); mirrorSchedule(); }, 400); }
async function unlock(pw) {
  const v = LS.get(VKEY, null); if (!v) return false;
  try {
    salt = unb64(v.salt); iter = v.iter || 310000;
    const k = await deriveKey(pw, salt, iter);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, k, unb64(v.ct));
    key = k; D = normalize(JSON.parse(dec.decode(pt))); return true;
  } catch (e) { key = null; D = null; return false; }
}
async function createVault(pw) {
  salt = crypto.getRandomValues(new Uint8Array(16)); iter = 310000;
  key = await deriveKey(pw, salt, iter); D = normalize({}); await persist();
}
async function changePassword(pw) {
  const newSalt = crypto.getRandomValues(new Uint8Array(16));
  const newKey = await deriveKey(pw, newSalt, iter);
  await reencryptDocs(key, newKey);
  salt = newSalt; key = newKey; await persist();
}
function lock() { clearTimeout(saveT); if (key && D) persist(); key = null; D = null; if (ui.docURL) { URL.revokeObjectURL(ui.docURL); ui.docURL = null; ui.docView = null; } render(); }
function normalize(d) {
  d.lessons = d.lessons || [];
  d.absences = d.absences || {};
  d.grades = d.grades || {};
  d.checklist = d.checklist || { template: defaultTemplate(), done: {} };
  d.checklist.template = migrateTemplate(d.checklist.template);
  d.settings = d.settings || { rounding: 0.5 };
  d.docs = d.docs || [];
  d.timetable = d.timetable || { slots: DIDAC_SLOTS.map(x => ({ ...x })), cells: {} };
  return d;
}
function defaultTemplate() {
  const mk = (sec, n) => Array.from({ length: n }, (_, i) => ({ id: `s${sec}${i + 1}`, key: `cls_${sec}${i + 1}` }));
  return { before: mk('b', 6), during: mk('d', 5), after: mk('a', 3) };
}
// Ancienne checklist standard (v1) jamais personnalisée → nouvelle checklist standard de Tony
function migrateTemplate(t) {
  const fresh = defaultTemplate();
  ['before', 'during', 'after'].forEach(k => { if (t[k] && t[k].length && t[k].every(it => it.key && it.key.startsWith('cl_') && it.text === undefined)) t[k] = fresh[k]; });
  return t;
}
function bumpIdle() { clearTimeout(idleT); if (key) idleT = setTimeout(lock, IDLE_MIN * 60000); }
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, bumpIdle, { passive: true }));

/* ---------- Interface ---------- */
let open = false, tab = 'agenda';
const ui = { cls: null, week: null, absDate: todayISO(), clDate: todayISO(), clEdit: false, editLesson: null };
const btn = $('#btnProf');
btn.onclick = () => { open = !open; render(); };
window.addEventListener('didac-lang', () => render());
window.addEventListener('didac-classes', () => render());
window.addEventListener('didac-vault-replaced', () => { key = null; D = null; render(); });

let root = null;
function render() {
  btn.setAttribute('aria-pressed', open); document.body.classList.toggle('prof-open', open);
  const lbl = btn.querySelector('.lbl'); if (lbl) lbl.textContent = open ? '← ' + T('backToBoard') : T('profSpace');
  if (!open) { if (root) { root.remove(); root = null; } return; }
  if (!root) { root = document.createElement('section'); root.className = 'prof'; root.setAttribute('aria-label', T('profSpace')); $('#board').appendChild(root); bind(); }
  const S = A.state;
  if (!ui.cls || !A.classById(ui.cls)) ui.cls = S.classes[0] ? S.classes[0].id : null;
  if (!key) { root.innerHTML = lockScreen(); const i = root.querySelector('input'); i && i.focus(); return; }
  const tabs = [['timetable', 'class-lesson'], ['agenda', 'blank-calendar'], ['absences', 'user-single-neutral-male'], ['grades', 'trophy'], ['checklist', 'check-square'], ['documents', 'book-reading'], ['settings', 'information-circle']];
  root.innerHTML = `<div class="prof-head"><h2>${T('profSpace')}</h2>
      <div class="ptabs" role="group">${tabs.map(([k, ic]) => `<button data-tab="${k}" aria-pressed="${tab === k}">${tab === k ? ICON(ic, 'blanc') : ICON(ic)}${T('p_' + k)}</button>`).join('')}</div>
      <span class="sp"></span>
      <button class="btn btn--ghost" data-act="lock">${T('lock')}</button>
      <button class="btn" data-act="closeProf">${T('backToBoard')}</button></div>
    <div class="prof-main"><div class="prof-inner">${body()}</div></div>`;
}
function body() {
  switch (tab) {
    case 'agenda': return agenda();
    case 'absences': return absences();
    case 'grades': return grades();
    case 'checklist': return checklist();
    case 'timetable': return timetable();
    case 'documents': return documents();
    default: return settings();
  }
}
function classPicker() {
  const S = A.state;
  if (!S.classes.length) return `<span class="lbl-s">${T('noClass')}</span> <button class="btn btn--s" data-act="openClasses">${T('createClass')}</button>`;
  return `<label class="row"><span class="lbl-s">${T('class')}</span><select class="inp" data-role="pcls">${S.classes.map(c => `<option value="${c.id}" ${c.id === ui.cls ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>`;
}
const fmtDate = (iso, o) => new Date(iso + 'T12:00:00').toLocaleDateString(locale(), o || { weekday: 'long', day: 'numeric', month: 'long' });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ----- Verrou ----- */
function lockScreen() {
  const has = !!LS.get(VKEY, null);
  return `<div class="prof-main"><div class="card lock-card">
    <h3>${has ? T('unlockTitle') : T('createTitle')}</h3>
    <p style="margin:0">${has ? T('unlockText') : T('createText')}</p>
    <form data-role="lockform" class="cl-col" style="padding:0;gap:10px">
      <label class="field"><span>${T('password')}</span><input class="inp" type="password" name="pw" autocomplete="${has ? 'current-password' : 'new-password'}" required minlength="${has ? 1 : 8}"></label>
      ${has ? '' : `<label class="field"><span>${T('passwordAgain')}</span><input class="inp" type="password" name="pw2" autocomplete="new-password" required minlength="8"></label>`}
      <div data-role="msg"></div>
      <div class="row"><button class="btn">${has ? T('unlock') : T('createSpace')}</button><button type="button" class="btn btn--ghost" data-act="closeProf">${T('backToBoard')}</button></div>
    </form>
    ${has ? '' : `<div class="note note--q"><b>${T('important')}</b> ${T('noRecovery')}</div>`}
    <div class="note">${T('privacyNote')}</div>
  </div></div>`;
}

/* ----- Agenda : leçons, objectifs, devoirs ----- */
function mondayOf(iso) { const d = new Date(iso + 'T12:00:00'); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return d.toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function agenda() {
  ui.week = ui.week || mondayOf(todayISO());
  const end = addDays(ui.week, 6);
  const cls = A.classById(ui.cls);
  const L = D.lessons.filter(l => l.date >= ui.week && l.date <= end && (ui.filterAll || !l.classId || l.classId === ui.cls)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const ed = ui.editLesson ? D.lessons.find(l => l.id === ui.editLesson) : null;
  const hw = D.lessons.filter(l => l.homework && l.date >= addDays(todayISO(), -14) && (ui.filterAll || !l.classId || l.classId === ui.cls)).sort((a, b) => a.date.localeCompare(b.date));
  const days = {}; L.forEach(l => (days[l.date] = days[l.date] || []).push(l));
  const cname = id => (A.classById(id) || { name: '—' }).name;
  return `${pinnedDocs()}<div class="row">${classPicker()}<label class="chk"><input type="checkbox" data-role="allcls" ${ui.filterAll ? 'checked' : ''}> ${T('allClasses')}</label>
    <span style="flex:1"></span><button class="btn btn--ghost btn--s" data-act="fillWeek">${T('fillWeek')}</button></div>
  <div class="grid2" style="grid-template-columns:minmax(0,1.4fr) minmax(280px,1fr)">
    <div class="card">
      <div class="row"><button class="btn btn--ghost btn--s" data-act="wkPrev">←</button>
        <h3 style="flex:1;text-align:center">${T('week')} ${fmtDate(ui.week, { day: 'numeric', month: 'short' })} – ${fmtDate(end, { day: 'numeric', month: 'short', year: 'numeric' })}</h3>
        <button class="btn btn--ghost btn--s" data-act="wkToday">${T('today')}</button><button class="btn btn--ghost btn--s" data-act="wkNext">→</button></div>
      ${Object.keys(days).length ? Object.keys(days).map(d => `<div class="day-h">${cap(fmtDate(d))}</div>${days[d].map(l => `
        <div class="lesson"><div class="lesson-top"><b>${esc(l.time || '')}</b><span class="tag">${esc(cname(l.classId))}</span><b>${esc(l.topic || T('lesson'))}</b></div>
          ${l.objectives ? `<div><span class="tag tag--obj">${T('objectives')}</span><p>${esc(l.objectives)}</p></div>` : ''}
          ${l.homework ? `<div><span class="tag tag--hw">${T('homework')}</span><p>${esc(l.homework)}</p></div>` : ''}
          ${l.notes ? `<div><span class="tag">${T('notes')}</span><p>${esc(l.notes)}</p></div>` : ''}
          <div class="row"><button class="btn btn--ghost btn--s" data-editl="${l.id}">${T('edit')}</button><button class="btn btn--ghost btn--s" data-checkl="${l.id}">${T('p_checklist')}</button>${l.pageId && A.state.pages.some(p => p.id === l.pageId) ? `<button class="btn btn--s" data-gopage="${l.pageId}">▸ ${T('openPage')}</button>` : ''}</div></div>`).join('')}`).join('')
      : `<p class="lbl-s">${T('noLesson')}</p>`}
    </div>
    <div style="display:grid;gap:16px">
      ${eventsCard()}
      <form class="card" data-role="lessonform">
        <h3>${ed ? T('editLesson') : T('newLesson')}</h3>
        <div class="row"><label class="field" style="flex:1"><span>${T('date')}</span><input class="inp" type="date" name="date" value="${esc(ed ? ed.date : todayISO())}" required></label>
          <label class="field"><span>${T('time')}</span><input class="inp" type="time" name="time" value="${esc(ed ? ed.time : '')}"></label></div>
        ${A.state.classes.length ? `<label class="field"><span>${T('class')}</span><select class="inp" name="classId">${A.state.classes.map(c => `<option value="${c.id}" ${(ed ? ed.classId : ui.cls) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>${T('topic')}</span><input class="inp" name="topic" value="${esc(ed ? ed.topic : '')}"></label>
        <label class="field"><span>${T('objectives')}</span><textarea class="inp" name="objectives" placeholder="${T('objPh')}">${esc(ed ? ed.objectives : '')}</textarea></label>
        <label class="field"><span>${T('homework')}</span><textarea class="inp" name="homework">${esc(ed ? ed.homework : '')}</textarea></label>
        <label class="field"><span>${T('notes')}</span><textarea class="inp" name="notes">${esc(ed ? ed.notes : '')}</textarea></label>
        <label class="field"><span>${T('linkedPage')}</span><select class="inp" name="pageId"><option value="">—</option>${A.state.pages.map((p, j) => `<option value="${p.id}" ${ed && ed.pageId === p.id ? 'selected' : ''}>${esc(p.name || T('page') + ' ' + (j + 1))}</option>`).join('')}</select></label>
        <div class="row"><button class="btn">${T('save')}</button>${ed ? `<button type="button" class="btn btn--ghost" data-act="cancelEdit">${T('cancel')}</button><span style="flex:1"></span><button type="button" class="btn btn--black btn--s" data-act="delLesson">${T('delete')}</button>` : ''}</div>
      </form>
      <div class="card"><h3>${T('homeworkList')}</h3>
        ${hw.length ? hw.map(l => `<div class="lesson" style="border-left-color:var(--d-gelb)"><div class="lesson-top"><b>${cap(fmtDate(l.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</b><span class="tag">${esc(cname(l.classId))}</span></div><p>${esc(l.homework)}</p></div>`).join('') : `<p class="lbl-s">${T('noHomework')}</p>`}
      </div>
    </div>
  </div>`;
}

/* ----- Évènements (non chiffrés : visibles par le compte à rebours du tableau) ----- */
function eventsCard() {
  const S = A.state; S.events = S.events || [];
  const now = new Date().toISOString().slice(0, 16);
  const all = S.events.slice().sort((a, c) => a.date.localeCompare(c.date));
  const past = all.filter(e => e.date < now).length;
  const evs = ui.showPast ? all : all.filter(e => e.date >= now);
  return `<form class="card" data-role="eventform"><h3>${T('events')}</h3>
    <div class="row"><label class="field" style="flex:1;min-width:150px"><span>${T('eventName')}</span><input class="inp" name="title" required placeholder="${T('eventPh')}"></label>
      <label class="field"><span>${T('eventDate')}</span><input class="inp" type="datetime-local" name="date" required></label>
      <button class="btn" style="align-self:end">${T('add')}</button></div>
    ${evs.length ? evs.map(e => `<div class="lesson" style="border-left-color:${e.date < now ? 'var(--d-gris2)' : 'var(--d-blau)'}"><div class="lesson-top"><b>${esc(e.title)}</b><span class="tag">${new Date(e.date).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>${e.note ? `<p class="lbl-s">${esc(e.note)}</p>` : ''}
      <div class="row"><button type="button" class="btn btn--s" data-evshow="${e.id}">${T('showCountdown')}</button><button type="button" class="btn btn--ghost btn--s" data-evdel="${e.id}">${T('delete')}</button></div></div>`).join('') : `<p class="lbl-s" style="margin:0">${T('noEvents')}</p>`}
    <div class="row">${past ? `<button type="button" class="btn btn--ghost btn--s" data-act="showPast">${ui.showPast ? T('hidePast') : T('showPast').replace('{n}', past)}</button>` : ''}
      <label class="btn btn--ghost btn--s">${T('importEvents')}<input type="file" accept=".json,application/json" hidden data-role="evimport"></label></div>
    <p class="lbl-s" style="margin:0">${T('eventsNote')}</p></form>`;
}

/* ----- Absences ----- */
const STAT = ['P', 'A', 'R', 'E'];
function absences() {
  const cls = A.classById(ui.cls);
  if (!cls) return `<div class="card">${classPicker()}</div>`;
  const day = ((D.absences[cls.id] = D.absences[cls.id] || {})[ui.absDate]) || {};
  const all = D.absences[cls.id];
  const totals = s => { const t = { A: 0, R: 0, E: 0 }; Object.values(all).forEach(d => { if (d[s.id] && t[d[s.id]] !== undefined) t[d[s.id]]++; }); return t; };
  const dates = Object.keys(all).filter(d => Object.keys(all[d]).length).sort();
  return `<div class="row">${classPicker()}<label class="row"><span class="lbl-s">${T('date')}</span><input class="inp" type="date" data-role="absDate" value="${ui.absDate}"></label>
    <button class="btn btn--ghost btn--s" data-act="absToday">${T('today')}</button></div>
  <div class="grid2" style="grid-template-columns:minmax(0,1.2fr) minmax(280px,1fr)">
    <div class="card"><h3>${cap(fmtDate(ui.absDate))}</h3>
      <div class="row"><button class="btn btn--s btn--ghost" data-act="allPresent">${T('allPresent')}</button><span class="lbl-s">${T('absLegend')}</span></div>
      <table class="tbl"><thead><tr><th>${T('student')}</th><th>${T('status')}</th></tr></thead><tbody>
      ${cls.students.map(s => { const v = day[s.id] || 'P'; return `<tr><td>${esc(s.name)}</td><td><div class="abs-btns">${STAT.map(k => `<button class="st" data-s="${k}" data-stu="${s.id}" aria-pressed="${v === k}">${T('st_' + k)}</button>`).join('')}</div></td></tr>`; }).join('')}
      </tbody></table></div>
    <div class="card"><h3>${T('absSummary')}</h3>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${T('student')}</th><th class="num">${T('st_A')}</th><th class="num">${T('st_R')}</th><th class="num">${T('st_E')}</th></tr></thead><tbody>
      ${cls.students.map(s => { const t = totals(s); return `<tr><td>${esc(s.name)}</td><td class="num">${t.A}</td><td class="num">${t.R}</td><td class="num">${t.E}</td></tr>`; }).join('')}
      </tbody></table></div>
      <p class="lbl-s" style="margin:0">${T('lessonsRecorded').replace('{n}', dates.length)}</p>
      <div class="row"><button class="btn btn--ghost btn--s" data-act="absCsv">${T('exportCsv')}</button></div>
    </div>
  </div>`;
}

/* ----- Notes (échelle suisse 1–6) ----- */
function roundTo(v, step) { return Math.round(v / step) * step; }
function gradeOf(ev, raw) {
  if (raw === '' || raw === undefined || raw === null || isNaN(raw)) return null;
  const r = +raw;
  if (ev.type === 'grade') return Math.max(1, Math.min(6, r));
  if (!ev.max) return null;
  return Math.max(1, Math.min(6, roundTo(r / ev.max * 5 + 1, D.settings.rounding || 0.5)));
}
const fmtG = g => g === null ? '–' : (Math.round(g * 100) / 100).toLocaleString(locale(), { minimumFractionDigits: g % 1 ? 1 : 0, maximumFractionDigits: 2 });
function average(G, sid) {
  let s = 0, w = 0;
  G.evals.forEach(ev => { const g = gradeOf(ev, (G.marks[ev.id] || {})[sid]); if (g !== null) { s += g * (ev.weight || 1); w += (ev.weight || 1); } });
  return w ? s / w : null;
}
function grades() {
  const cls = A.classById(ui.cls);
  if (!cls) return `<div class="card">${classPicker()}</div>`;
  const G = D.grades[cls.id] = D.grades[cls.id] || { evals: [], marks: {} };
  return `<div class="row">${classPicker()}
    <label class="row"><span class="lbl-s">${T('rounding')}</span><select class="inp" data-role="rounding">${[0.5, 0.25, 0.1].map(r => `<option value="${r}" ${D.settings.rounding == r ? 'selected' : ''}>${r.toLocaleString(locale())}</option>`).join('')}</select></label></div>
  <form class="card" data-role="evalform"><h3>${T('newEval')}</h3>
    <div class="row">
      <label class="field" style="flex:2;min-width:180px"><span>${T('evalTitle')}</span><input class="inp" name="title" required placeholder="${T('evalPh')}"></label>
      <label class="field"><span>${T('date')}</span><input class="inp" type="date" name="date" value="${todayISO()}"></label>
      <label class="field"><span>${T('evalType')}</span><select class="inp" name="type"><option value="points">${T('typePoints')}</option><option value="grade">${T('typeGrade')}</option></select></label>
      <label class="field"><span>${T('maxPoints')}</span><input class="inp" type="number" name="max" min="0" step="0.5" style="width:6em" value="20"></label>
      <label class="field"><span>${T('weight')}</span><input class="inp" type="number" name="weight" min="0" step="0.5" style="width:5em" value="1"></label>
      <button class="btn" style="align-self:end">${T('add')}</button>
    </div>
    <p class="lbl-s" style="margin:0">${T('gradeFormula')}</p></form>
  <div class="card"><h3>${esc(cls.name)}</h3>
    ${G.evals.length ? `<div class="tbl-wrap"><table class="tbl tbl--grades"><thead><tr><th rowspan="2">${T('student')}</th>
      ${G.evals.map(ev => `<th class="num ev-start" colspan="${ev.type === 'points' ? 2 : 1}">${esc(ev.title)} <button class="w-x" data-delev="${ev.id}" title="${T('delete')}" aria-label="${T('delete')} ${esc(ev.title)}">×</button><br><span class="lbl-s">${ev.date ? fmtDate(ev.date, { day: 'numeric', month: 'short' }) : ''} · ${T('weight')} ×${ev.weight}</span></th>`).join('')}
      <th class="num ev-start" rowspan="2">${T('average')}<br><span class="lbl-s">/ 6</span></th></tr>
      <tr>${G.evals.map(ev => ev.type === 'points' ? `<th class="num ev-start sub">${T('pointsCol')}<br>/ ${ev.max}</th><th class="num sub col-grade">${T('gradeCol')}<br>/ 6</th>` : `<th class="num ev-start sub col-grade">${T('gradeCol')}<br>/ 6</th>`).join('')}</tr></thead><tbody>
      ${cls.students.map(s => { const av = average(G, s.id); return `<tr><td>${esc(s.name)}</td>${G.evals.map(ev => { const raw = (G.marks[ev.id] || {})[s.id]; const g = gradeOf(ev, raw); const inp = `<input class="inp" inputmode="decimal" data-ev="${ev.id}" data-stu="${s.id}" value="${raw ?? ''}" aria-label="${esc(s.name)} – ${esc(ev.title)} (${ev.type === 'points' ? T('pointsCol') : T('gradeCol')})">`;
          return ev.type === 'points' ? `<td class="num ev-start">${inp}</td><td class="num col-grade" data-gout="${ev.id}|${s.id}">${fmtG(g)}</td>` : `<td class="num ev-start col-grade">${inp}</td>`; }).join('')}
        <td class="num avg ev-start ${av === null ? '' : av < 4 ? 'mark-bad' : 'mark-ok'}" data-avg="${s.id}">${fmtG(av)}</td></tr>`; }).join('')}
      </tbody></table></div>
      <p class="lbl-s" style="margin:0">${T('gradeLegend')}</p>
      <div class="row"><button class="btn btn--ghost btn--s" data-act="gradesCsv">${T('exportCsv')}</button></div>`
    : `<p class="lbl-s">${T('noEval')}</p>`}
  </div>`;
}

/* ----- Checklist ----- */
const SECS = [['before', 'cl-col--before'], ['during', 'cl-col--during'], ['after', 'cl-col--after']];
const itemText = it => it.text ?? T(it.key);
function checklist() {
  const tpl = D.checklist.template;
  const k = ui.clDate + '|' + (ui.cls || '');
  const done = D.checklist.done[k] || [];
  const total = SECS.reduce((n, [s]) => n + tpl[s].length, 0);
  const pct = total ? Math.round(done.filter(id => SECS.some(([s]) => tpl[s].some(i => i.id === id))).length / total * 100) : 0;
  return `<div class="row">${classPicker()}<label class="row"><span class="lbl-s">${T('date')}</span><input class="inp" type="date" data-role="clDate" value="${ui.clDate}"></label>
    <button class="btn btn--ghost btn--s" data-act="clToday">${T('today')}</button><span style="flex:1"></span>
    <button class="btn ${ui.clEdit ? '' : 'btn--ghost'}" data-act="clEdit">${ui.clEdit ? T('doneEditing') : T('customize')}</button></div>
  ${ui.clEdit ? `<div class="note note--tip"><b>${T('tip')}</b> ${T('clEditHint')}</div>` : `<div class="card" style="gap:6px"><div class="row"><b style="font-weight:700">${pct} %</b><span class="lbl-s">${T('clProgress')}</span></div><div class="progress"><i style="width:${pct}%"></i></div></div>`}
  <div class="grid3">${SECS.map(([s, c]) => `<div class="cl-col ${c}"><h4>${T('cl_' + s)} (${tpl[s].length})</h4>
    ${tpl[s].map(it => ui.clEdit
      ? `<div class="cl-item"><input class="inp" data-cltxt="${s}|${it.id}" value="${esc(itemText(it))}" aria-label="${T('task')}"><button class="w-x" data-clup="${s}|${it.id}" title="↑" aria-label="↑">↑</button><button class="w-x" data-cldel="${s}|${it.id}" title="${T('delete')}" aria-label="${T('delete')}">×</button></div>`
      : `<label class="cl-item ${done.includes(it.id) ? 'is-done' : ''}"><input type="checkbox" data-clchk="${it.id}" ${done.includes(it.id) ? 'checked' : ''}><span>${esc(itemText(it))}</span></label>`).join('')}
    ${ui.clEdit ? `<form class="cl-item" data-cladd="${s}"><input class="inp" name="t" placeholder="${T('newTask')}"><button class="btn btn--s">${T('add')}</button></form>` : ''}
  </div>`).join('')}</div>
  ${ui.clEdit ? `<div class="row"><button class="btn btn--ghost btn--s" data-act="clReset">${T('clReset')}</button></div>` : `<div class="row"><button class="btn btn--ghost btn--s" data-act="clUncheck">${T('clUncheck')}</button></div>`}`;
}

/* ----- Réglages, sauvegarde ----- */
function settings() {
  const v = LS.get(VKEY, {});
  return `<div class="grid2">
    <form class="card" data-role="pwform"><h3>${T('changePw')}</h3>
      <label class="field"><span>${T('newPw')}</span><input class="inp" type="password" name="pw" minlength="8" required autocomplete="new-password"></label>
      <label class="field"><span>${T('passwordAgain')}</span><input class="inp" type="password" name="pw2" minlength="8" required autocomplete="new-password"></label>
      <div data-role="msg"></div><div class="row"><button class="btn">${T('save')}</button></div></form>
    <div class="card"><h3>${T('backup')}</h3>
      <p style="margin:0">${T('backupText')}</p>
      <div class="row"><button class="btn" data-act="backup">${T('exportBoard')}</button>
      <label class="btn btn--ghost">${T('importBoard')}<input type="file" accept=".json,application/json" hidden data-role="pimport"></label></div>
      <p class="lbl-s" style="margin:0">${T('lastSaved')} ${v.saved ? new Date(v.saved).toLocaleString(locale()) : '–'}</p></div>
    <div class="card"><h3>${T('dataProtection')}</h3><div class="note">${T('privacyLong')}</div></div>
    <div class="card"><h3>${T('dangerZone')}</h3><p style="margin:0">${T('wipeText')}</p><div class="row"><button class="btn btn--black" data-act="wipe">${T('wipe')}</button></div></div>
  </div>`;
}


/* =====================================================================
   DOCUMENTS PDF (chiffrés, IndexedDB du navigateur — jamais publiés)
   ===================================================================== */
const DOCDB = 'didac-tableau-docs';
function idb() { return new Promise((res, rej) => { const r = indexedDB.open(DOCDB, 1); r.onupgradeneeded = () => r.result.createObjectStore('docs', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbOp(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction('docs', mode); const req = fn(tx.objectStore('docs')); tx.oncomplete = () => { db.close(); res(req ? req.result : undefined); }; tx.onerror = () => rej(tx.error); });
}
const idbPut = rec => idbOp('readwrite', s => s.put(rec));
const idbGet = id => idbOp('readonly', s => s.get(id));
const idbDel = id => idbOp('readwrite', s => s.delete(id));
const idbAll = () => idbOp('readonly', s => s.getAll());
const idbClear = () => idbOp('readwrite', s => s.clear());
async function addDoc(file, meta) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await file.arrayBuffer());
  const id = uid(); await idbPut({ id, iv, ct });
  D.docs.push({ id, ...meta, name: file.name, size: file.size, type: file.type || 'application/pdf', added: new Date().toISOString() });
  await persist();
}
async function docBlob(id) {
  const r = await idbGet(id); if (!r) throw new Error('missing');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv }, key, r.ct);
  const m = D.docs.find(d => d.id === id);
  return new Blob([pt], { type: (m && m.type) || 'application/pdf' });
}
async function reencryptDocs(oldKey, newKey) {
  for (const r of await idbAll()) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv }, oldKey, r.ct);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    await idbPut({ id: r.id, iv, ct: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, newKey, pt) });
  }
}
// Sauvegarde : les PDF voyagent chiffrés dans le fichier de sauvegarde
window.DidacDocs = {
  async exportAll() { try { return (await idbAll()).map(r => ({ id: r.id, iv: b64(r.iv), ct: b64(r.ct) })); } catch (e) { return []; } },
  async importAll(list) { await idbClear(); for (const r of list || []) await idbPut({ id: r.id, iv: unb64(r.iv), ct: unb64(r.ct) }); }
};

const DOC_CATS = ['termine', 'ferien', 'semester', 'stundenplan', 'other'];
const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko';
function documents() {
  const docs = D.docs;
  const view = ui.docView ? docs.find(d => d.id === ui.docView) : null;
  return `${view ? `<div class="card"><div class="row"><h3 style="flex:1">${esc(view.title || view.name)}</h3>
      <a class="btn btn--ghost btn--s" href="${ui.docURL}" target="_blank" rel="noopener">${T('newTab')}</a>
      <a class="btn btn--ghost btn--s" href="${ui.docURL}" download="${esc(view.name)}">${T('download')}</a>
      <button class="btn btn--s" data-act="docClose">${T('close')}</button></div>
      <iframe class="doc-frame" src="${ui.docURL}" title="${esc(view.title || view.name)}"></iframe></div>` : ''}
  <form class="card" data-role="docform"><h3>${T('addDoc')}</h3>
    <div class="row">
      <label class="field" style="flex:2;min-width:200px"><span>${T('docFile')}</span><input class="inp" type="file" name="file" accept="application/pdf,.pdf" required></label>
      <label class="field"><span>${T('docCat')}</span><select class="inp" name="cat">${DOC_CATS.map(c => `<option value="${c}">${T('dc_' + c)}</option>`).join('')}</select></label>
      <label class="field" style="flex:1;min-width:140px"><span>${T('docSubject')}</span><input class="inp" name="subject" placeholder="${T('docSubjectPh')}"></label>
      <label class="field" style="flex:1;min-width:140px"><span>${T('docTitle')}</span><input class="inp" name="title" placeholder="${T('docTitlePh')}"></label>
      <button class="btn" style="align-self:end">${T('add')}</button></div>
    <p class="lbl-s" style="margin:0">${T('docPrivacy')}</p></form>
  <div class="grid2">${DOC_CATS.map(c => { const L = docs.filter(d => d.cat === c).sort((a, b) => (a.subject || '').localeCompare(b.subject || '') || (a.title || a.name).localeCompare(b.title || b.name));
    return `<div class="card"><h3>${T('dc_' + c)}</h3>${L.length ? L.map(d => `<div class="doc-row"><button class="doc-open" data-docopen="${d.id}">${ICON('news-paper')}<span><b>${esc(d.title || d.name)}</b>${d.subject ? ` <span class="tag">${esc(d.subject)}</span>` : ''}<br><span class="lbl-s">${esc(d.name)} · ${fmtSize(d.size)}</span></span></button>
      <button class="w-x" data-docdel="${d.id}" title="${T('delete')}" aria-label="${T('delete')} ${esc(d.title || d.name)}">×</button></div>`).join('') : `<p class="lbl-s" style="margin:0">${T('noDoc')}</p>`}</div>`; }).join('')}</div>`;
}
function pinnedDocs() {
  const L = D.docs.filter(d => d.cat === 'termine' || d.cat === 'ferien');
  if (!L.length) return '';
  return `<div class="pinbar"><span class="lbl-s">${T('importantDocs')}</span>${L.map(d => `<button class="btn btn--ghost btn--s" data-docopen="${d.id}">${esc(d.title || d.name)}</button>`).join('')}</div>`;
}
async function openDoc(id) {
  try {
    if (ui.docURL) URL.revokeObjectURL(ui.docURL);
    ui.docURL = URL.createObjectURL(await docBlob(id)); ui.docView = id; tab = 'documents'; render();
    const m = root.querySelector('.prof-main'); if (m) m.scrollTop = 0;
  } catch (e) { A.openDlg(`<h2>${T('error')}</h2><p>${T('docErr')}</p><div class="row row--end"><button class="btn" data-act="closeDlg">${T('ok')}</button></div>`); }
}

/* =====================================================================
   MON EMPLOI DU TEMPS (grille vide, créneaux Didac Bern)
   ===================================================================== */
const DIDAC_SLOTS = [['08:40', '09:20'], ['09:25', '10:05'], ['10:20', '11:00'], ['11:05', '11:45'], ['11:50', '12:30'], ['12:35', '13:30', 1], ['13:30', '14:10'], ['14:20', '15:00'], ['15:05', '15:45'], ['15:50', '16:30'], ['16:40', '17:20']]
  .map(([s, e, brk]) => ({ s, e, brk: !!brk }));
const TT_COLORS = ['gris1', 'gelb', 'blau', 'gruen', 'orange', 'pink'];
const DAYS = [1, 2, 3, 4, 5];
function ttCellLesson(d, i, c) {
  const date = addDays(ui.ttWeek, d - 1), sl = D.timetable.slots[i];
  return D.lessons.find(l => l.date === date && l.time === sl.s && (!c.classId || l.classId === c.classId));
}
function timetable() {
  ui.ttWeek = ui.ttWeek || mondayOf(todayISO());
  const TTb = D.timetable, today = todayISO(), now = new Date(), hm = `${A.pad(now.getHours())}:${A.pad(now.getMinutes())}`;
  const cname = id => (A.classById(id) || {}).name || '';
  const head = `<div class="row"><button class="btn btn--ghost btn--s" data-act="ttPrev">←</button>
      <h3 style="flex:1;text-align:center;color:var(--d-rot);margin:0">${T('week')} ${fmtDate(ui.ttWeek, { day: 'numeric', month: 'short' })} – ${fmtDate(addDays(ui.ttWeek, 4), { day: 'numeric', month: 'short', year: 'numeric' })}</h3>
      <button class="btn btn--ghost btn--s" data-act="ttToday">${T('today')}</button><button class="btn btn--ghost btn--s" data-act="ttNext">→</button>
      <button class="btn btn--ghost btn--s" data-act="ttSlots" aria-pressed="${!!ui.ttEdit}">${T('editSlots')}</button></div>`;
  if (ui.ttEdit) return head + `<form class="card" data-role="slotform"><h3>${T('editSlots')}</h3>
    <table class="tbl" style="width:auto"><thead><tr><th>${T('slotStart')}</th><th>${T('slotEnd')}</th><th>${T('slotBreak')}</th><th></th></tr></thead><tbody>
    ${TTb.slots.map((sl, i) => `<tr><td><input class="inp" type="time" name="s${i}" value="${sl.s}" required></td><td><input class="inp" type="time" name="e${i}" value="${sl.e}" required></td><td class="num"><input type="checkbox" name="b${i}" ${sl.brk ? 'checked' : ''}></td><td><button type="button" class="w-x" data-slotdel="${i}" aria-label="${T('delete')}">×</button></td></tr>`).join('')}
    </tbody></table>
    <div class="row"><button type="button" class="btn btn--ghost btn--s" data-act="slotAdd">+ ${T('addSlot')}</button><button type="button" class="btn btn--ghost btn--s" data-act="slotReset">${T('slotReset')}</button><span style="flex:1"></span><button class="btn">${T('save')}</button></div>
    <p class="lbl-s" style="margin:0">${T('slotsNote')}</p></form>`;
  return head + `<div class="note note--tip"><b>${T('tip')}</b> ${T('ttHint')}</div>
  <div class="tt-wrap"><table class="tt"><thead><tr><th></th>${DAYS.map(d => { const date = addDays(ui.ttWeek, d - 1); return `<th class="${date === today ? 'is-today' : ''}">${cap(fmtDate(date, { weekday: 'long' }))}<br><span class="lbl-s">${fmtDate(date, { day: 'numeric', month: 'short' })}</span></th>`; }).join('')}</tr></thead><tbody>
  ${TTb.slots.map((sl, i) => sl.brk
    ? `<tr class="tt-brk"><th>${sl.s}–${sl.e}</th><td colspan="5">${T('lunch')}</td></tr>`
    : `<tr><th class="${ui.ttWeek === mondayOf(today) && hm >= sl.s && hm < sl.e ? 'is-now' : ''}">${sl.s}<br><span class="lbl-s">${sl.e}</span></th>${DAYS.map(d => {
      const c = TTb.cells[d + '-' + i]; const date = addDays(ui.ttWeek, d - 1);
      if (!c) return `<td class="${date === today ? 'is-today' : ''}"><button class="tt-empty" data-cell="${d}-${i}" aria-label="${T('ttAdd')}">+</button></td>`;
      const les = ttCellLesson(d, i, c);
      return `<td class="${date === today ? 'is-today' : ''}"><button class="tt-cell" data-cell="${d}-${i}" style="background:var(--d-${c.color || 'gris1'})"><b>${esc(c.subject || cname(c.classId))}</b>${c.classId && c.subject ? `<span>${esc(cname(c.classId))}</span>` : ''}${c.room ? `<span>${T('room')} ${esc(c.room)}</span>` : ''}${les ? `<span class="tt-les">✓ ${esc(les.topic || T('lesson'))}</span>` : ''}${c.pageId ? `<span class="tt-pg">▸ ${T('page')}</span>` : ''}</button></td>`;
    }).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}
function cellDialog(d, i) {
  const k = d + '-' + i, c = D.timetable.cells[k] || {}, sl = D.timetable.slots[i], S = A.state;
  const date = addDays(ui.ttWeek, d - 1);
  const pages = S.pages.map((p, j) => `<option value="${p.id}" ${c.pageId === p.id ? 'selected' : ''}>${esc(p.name || T('page') + ' ' + (j + 1))}</option>`).join('');
  A.openDlg(`<h2>${cap(fmtDate(date, { weekday: 'long' }))} · ${sl.s}–${sl.e}</h2>
    <form data-role="cellform" class="cd-form" style="padding:0;max-width:none">
      <div class="row"><label class="field" style="flex:1"><span>${T('ttSubject')}</span><input class="inp" name="subject" value="${esc(c.subject || '')}" placeholder="${T('ttSubjectPh')}"></label>
        <label class="field" style="width:7em"><span>${T('room')}</span><input class="inp" name="room" value="${esc(c.room || '')}"></label></div>
      <label class="field"><span>${T('class')}</span><select class="inp" name="classId"><option value="">—</option>${S.classes.map(x => `<option value="${x.id}" ${c.classId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field"><span>${T('linkedPage')}</span><select class="inp" name="pageId"><option value="">—</option>${pages}</select></label>
      <div class="field"><span>${T('color')}</span><div class="row">${TT_COLORS.map(col => `<label class="sw-radio"><input type="radio" name="color" value="${col}" ${(c.color || 'gris1') === col ? 'checked' : ''}><span class="sw" style="background:var(--d-${col})" title="${T('bg_' + col)}"></span></label>`).join('')}</div></div>
      <label class="chk"><input type="checkbox" name="all"> ${T('ttRepeat')}</label>
      <div class="row">${D.timetable.cells[k] ? `<button type="button" class="btn btn--black btn--s" data-cact="del">${T('delete')}</button>` : ''}<span style="flex:1"></span>
        <button type="button" class="btn btn--ghost" data-act="closeDlg">${T('cancel')}</button><button class="btn">${T('save')}</button></div>
      ${D.timetable.cells[k] ? `<div class="row" style="border-top:1px solid var(--d-gris1);padding-top:12px">
        ${c.pageId && S.pages.some(p => p.id === c.pageId) ? `<button type="button" class="btn btn--s" data-cact="page">▸ ${T('openPage')}</button>` : ''}
        <button type="button" class="btn btn--s btn--ghost" data-cact="lesson">${T('lessonOf')} ${fmtDate(date, { day: 'numeric', month: 'short' })}</button></div>` : ''}
    </form>`, body => {
    const f = $('form', body);
    f.onsubmit = e => {
      e.preventDefault();
      const o = { subject: f.subject.value.trim(), room: f.room.value.trim(), classId: f.classId.value, pageId: f.pageId.value, color: (f.querySelector('[name=color]:checked') || {}).value || 'gris1' };
      const keys = f.all.checked ? D.timetable.slots.map((s, j) => j).filter(j => !D.timetable.slots[j].brk).map(j => d + '-' + j).filter(kk => kk === k || !D.timetable.cells[kk]) : [k];
      keys.forEach(kk => { D.timetable.cells[kk] = { ...o }; });
      saveSoon(); A.closeDlg(); render();
    };
    // la case « toute la journée » n'a de sens qu'à la création
    f.all.closest('label').hidden = !!D.timetable.cells[k];
    body.querySelectorAll('[data-cact]').forEach(b => b.onclick = () => {
      const a = b.dataset.cact;
      if (a === 'del') { delete D.timetable.cells[k]; saveSoon(); A.closeDlg(); render(); }
      if (a === 'page') { A.closeDlg(); open = false; render(); A.goPage(c.pageId); }
      if (a === 'lesson') {
        let l = ttCellLesson(d, i, c);
        if (!l) { l = { id: uid(), date, time: sl.s, classId: c.classId || ui.cls || '', topic: c.subject || '', objectives: '', homework: '', notes: '', pageId: c.pageId || '' }; D.lessons.push(l); saveSoon(); }
        A.closeDlg(); ui.editLesson = l.id; ui.week = mondayOf(date); if (l.classId) ui.cls = l.classId; tab = 'agenda'; render();
      }
    });
  });
}
function fillWeekFromTimetable() {
  let n = 0;
  Object.entries(D.timetable.cells).forEach(([k, c]) => {
    const [d, i] = k.split('-').map(Number); const sl = D.timetable.slots[i]; if (!sl || sl.brk) return;
    const date = addDays(ui.week, d - 1);
    if (D.lessons.some(l => l.date === date && l.time === sl.s && (!c.classId || l.classId === c.classId))) return;
    D.lessons.push({ id: uid(), date, time: sl.s, classId: c.classId || '', topic: c.subject || '', objectives: '', homework: '', notes: '', pageId: c.pageId || '' }); n++;
  });
  saveSoon(); return n;
}
async function importEvents(file) {
  try {
    const d = JSON.parse(await file.text()); const list = Array.isArray(d) ? d : d.events;
    if (!Array.isArray(list)) throw new Error('format');
    const S = A.state; S.events = S.events || []; let n = 0;
    list.forEach(e => { if (!e.title || !e.date) return; if (S.events.some(x => x.title === e.title && x.date === e.date)) return; S.events.push({ id: uid(), title: String(e.title), date: String(e.date).slice(0, 16), note: e.note ? String(e.note) : '' }); n++; });
    A.save(); window.dispatchEvent(new Event('didac-events')); render();
    A.openDlg(`<h2>${T('events')}</h2><p>${T('eventsImported').replace('{n}', n)}</p><div class="row row--end"><button class="btn" data-act="closeDlg">${T('ok')}</button></div>`);
  } catch (e) { A.openDlg(`<h2>${T('error')}</h2><p>${T('eventsImportErr')}</p><div class="row row--end"><button class="btn" data-act="closeDlg">${T('ok')}</button></div>`); }
}

/* Évènements liés aux nouvelles zones */
function bindExtra() {
  root.addEventListener('submit', async e => {
    const f = e.target;
    if (f.dataset.role === 'docform') {
      e.preventDefault(); const file = f.file.files[0]; if (!file) return;
      const b = f.querySelector('button.btn'); b.disabled = true; b.textContent = T('checking');
      await addDoc(file, { cat: f.cat.value, subject: f.subject.value.trim(), title: f.title.value.trim() || file.name.replace(/\.pdf$/i, '') });
      render();
    }
    if (f.dataset.role === 'slotform') {
      e.preventDefault();
      const n = D.timetable.slots.length; const slots = [];
      for (let i = 0; i < n; i++) slots.push({ s: f['s' + i].value, e: f['e' + i].value, brk: f['b' + i].checked });
      D.timetable.slots = slots; ui.ttEdit = false; saveSoon(); render();
    }
  });
  root.addEventListener('change', e => { if (e.target.dataset.role === 'evimport' && e.target.files[0]) importEvents(e.target.files[0]); });
  root.addEventListener('click', async e => {
    const t = e.target;
    const op = t.closest('[data-docopen]'); if (op) { openDoc(op.dataset.docopen); return; }
    const dd = t.closest('[data-docdel]');
    if (dd) { const m = D.docs.find(x => x.id === dd.dataset.docdel); if (await A.confirmBox(T('delDocQ').replace('{d}', esc(m.title || m.name)), T('delete'))) { await idbDel(m.id); D.docs = D.docs.filter(x => x !== m); if (ui.docView === m.id) { ui.docView = null; } await persist(); render(); } return; }
    const cell = t.closest('[data-cell]'); if (cell) { const [d, i] = cell.dataset.cell.split('-').map(Number); cellDialog(d, i); return; }
    const sd = t.closest('[data-slotdel]'); if (sd) { D.timetable.slots.splice(+sd.dataset.slotdel, 1); remapCells(+sd.dataset.slotdel); saveSoon(); render(); return; }
    const gp = t.closest('[data-gopage]'); if (gp) { open = false; render(); A.goPage(gp.dataset.gopage); return; }
    const a = t.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (act === 'docClose') { if (ui.docURL) URL.revokeObjectURL(ui.docURL); ui.docURL = null; ui.docView = null; render(); }
    if (act === 'ttPrev') { ui.ttWeek = addDays(ui.ttWeek, -7); render(); }
    if (act === 'ttNext') { ui.ttWeek = addDays(ui.ttWeek, 7); render(); }
    if (act === 'ttToday') { ui.ttWeek = mondayOf(todayISO()); render(); }
    if (act === 'ttSlots') { ui.ttEdit = !ui.ttEdit; render(); }
    if (act === 'slotAdd') { const last = D.timetable.slots[D.timetable.slots.length - 1]; D.timetable.slots.push({ s: last ? last.e : '08:00', e: last ? last.e : '08:45', brk: false }); render(); }
    if (act === 'slotReset') { if (await A.confirmBox(T('slotResetQ'))) { D.timetable.slots = DIDAC_SLOTS.map(x => ({ ...x })); saveSoon(); render(); } }
    if (act === 'fillWeek') { const n = fillWeekFromTimetable(); render(); A.openDlg(`<h2>${T('p_agenda')}</h2><p>${n ? T('weekFilled').replace('{n}', n) : T('weekFilledNone')}</p><div class="row row--end"><button class="btn" data-act="closeDlg">${T('ok')}</button></div>`); }
    if (act === 'showPast') { ui.showPast = !ui.showPast; render(); }
  });
}
// quand on supprime un créneau, les cases des créneaux suivants remontent d'une ligne
function remapCells(removed) {
  const out = {};
  Object.entries(D.timetable.cells).forEach(([k, c]) => { const [d, i] = k.split('-').map(Number); if (i === removed) return; out[d + '-' + (i > removed ? i - 1 : i)] = c; });
  D.timetable.cells = out;
}

/* ---------- CSV ---------- */
const csvCell = v => { v = String(v ?? ''); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const csv = rows => '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');

/* ---------- Évènements ---------- */
function bind() {
  bindExtra();
  root.addEventListener('submit', async e => {
    const f = e.target; e.preventDefault();
    const role = f.dataset.role;
    if (role === 'lockform') {
      const msg = $('[data-role=msg]', f); const b = f.querySelector('button'); b.disabled = true;
      if (f.pw2) {
        if (f.pw.value !== f.pw2.value) { msg.innerHTML = `<div class="err">${T('pwMismatch')}</div>`; b.disabled = false; return; }
        await createVault(f.pw.value); bumpIdle(); render();
      } else {
        msg.innerHTML = `<div class="note">${T('checking')}</div>`;
        if (await unlock(f.pw.value)) { bumpIdle(); render(); }
        else { msg.innerHTML = `<div class="err">${T('pwWrong')}</div>`; b.disabled = false; f.pw.select(); }
      }
    }
    if (role === 'pwform') {
      const msg = $('[data-role=msg]', f);
      if (f.pw.value !== f.pw2.value) { msg.innerHTML = `<div class="err">${T('pwMismatch')}</div>`; return; }
      await changePassword(f.pw.value); f.reset(); msg.innerHTML = `<div class="ok">${T('pwChanged')}</div>`;
    }
    if (role === 'lessonform') {
      const o = Object.fromEntries(new FormData(f));
      if (ui.editLesson) { Object.assign(D.lessons.find(l => l.id === ui.editLesson), o); ui.editLesson = null; }
      else D.lessons.push({ id: uid(), ...o, classId: o.classId || ui.cls });
      ui.week = mondayOf(o.date); saveSoon(); render();
    }
    if (role === 'eventform') {
      const S = A.state; S.events = S.events || [];
      S.events.push({ id: uid(), title: f.title.value.trim(), date: f.date.value }); A.save();
      window.dispatchEvent(new Event('didac-events')); render(); return;
    }
    if (role === 'evalform') {
      const o = Object.fromEntries(new FormData(f));
      const G = D.grades[ui.cls];
      G.evals.push({ id: uid(), title: o.title.trim(), date: o.date, type: o.type, max: parseFloat(o.max) || 0, weight: parseFloat(o.weight) || 1 });
      saveSoon(); render();
    }
    if (f.dataset.cladd) {
      const t = f.t.value.trim(); if (!t) return;
      D.checklist.template[f.dataset.cladd].push({ id: uid(), text: t }); saveSoon(); render();
      const nf = root.querySelector(`[data-cladd="${f.dataset.cladd}"] input`); nf && nf.focus();
    }
  });

  root.addEventListener('change', e => {
    const t = e.target, r = t.dataset.role;
    if (r === 'pcls') { ui.cls = t.value; render(); }
    if (r === 'allcls') { ui.filterAll = t.checked; render(); }
    if (r === 'absDate') { ui.absDate = t.value || todayISO(); render(); }
    if (r === 'clDate') { ui.clDate = t.value || todayISO(); render(); }
    if (r === 'rounding') { D.settings.rounding = parseFloat(t.value); saveSoon(); render(); }
    if (r === 'pimport') { importFile(t.files[0]); }
    if (t.dataset.clchk) {
      const k = ui.clDate + '|' + (ui.cls || ''); const d = D.checklist.done[k] = D.checklist.done[k] || [];
      const i = d.indexOf(t.dataset.clchk); if (t.checked && i < 0) d.push(t.dataset.clchk); if (!t.checked && i >= 0) d.splice(i, 1);
      saveSoon(); render();
    }
    if (t.dataset.cltxt) {
      const [s, id] = t.dataset.cltxt.split('|'); const it = D.checklist.template[s].find(x => x.id === id);
      if (it) { it.text = t.value.trim() || itemText(it); saveSoon(); }
    }
  });

  root.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.ev) {
      const G = D.grades[ui.cls]; const ev = G.evals.find(x => x.id === t.dataset.ev);
      const v = t.value.replace(',', '.').trim();
      const m = G.marks[ev.id] = G.marks[ev.id] || {};
      if (v === '') delete m[t.dataset.stu]; else if (!isNaN(v)) m[t.dataset.stu] = parseFloat(v);
      const go = root.querySelector(`[data-gout="${ev.id}|${t.dataset.stu}"]`); if (go) go.textContent = fmtG(gradeOf(ev, m[t.dataset.stu]));
      const av = average(G, t.dataset.stu); const cell = root.querySelector(`[data-avg="${t.dataset.stu}"]`);
      if (cell) { cell.textContent = fmtG(av); cell.className = 'num avg ev-start ' + (av === null ? '' : av < 4 ? 'mark-bad' : 'mark-ok'); }
      saveSoon();
    }
  });

  root.addEventListener('click', async e => {
    const t = e.target;
    const tb = t.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; ui.editLesson = null; render(); return; }
    const st = t.closest('.st');
    if (st) {
      const all = D.absences[ui.cls] = D.absences[ui.cls] || {}; const d = all[ui.absDate] = all[ui.absDate] || {};
      if (st.dataset.s === 'P') delete d[st.dataset.stu]; else d[st.dataset.stu] = st.dataset.s;
      // le tableau de classe utilise aussi les absents du jour (nom au hasard, groupes)
      if (ui.absDate === todayISO()) {
        const S = A.state; const ids = Object.keys(d).filter(k => d[k] === 'A' || d[k] === 'E');
        S.presence[ui.cls] = { date: todayISO(), absent: ids }; A.save();
      }
      saveSoon(); render(); return;
    }
    const evs = t.closest('[data-evshow]');
    if (evs) { open = false; render(); A.addWidget('countdown', { eventId: evs.dataset.evshow, daysOnly: true }); return; }
    const evd = t.closest('[data-evdel]');
    if (evd) { const S = A.state; const e = S.events.find(x => x.id === evd.dataset.evdel); if (await A.confirmBox(T('delEventQ').replace('{e}', esc(e.title)), T('delete'))) { S.events = S.events.filter(x => x !== e); A.save(); window.dispatchEvent(new Event('didac-events')); render(); } return; }
    const el = t.closest('[data-editl]'); if (el) { ui.editLesson = el.dataset.editl; render(); root.querySelector('.prof-main').scrollTop = 0; return; }
    const cl = t.closest('[data-checkl]'); if (cl) { const l = D.lessons.find(x => x.id === cl.dataset.checkl); ui.clDate = l.date; ui.cls = l.classId; tab = 'checklist'; render(); return; }
    const dev = t.closest('[data-delev]');
    if (dev) {
      const G = D.grades[ui.cls]; const ev = G.evals.find(x => x.id === dev.dataset.delev);
      if (await A.confirmBox(T('delEvalQ').replace('{e}', esc(ev.title)), T('delete'))) { G.evals = G.evals.filter(x => x !== ev); delete G.marks[ev.id]; saveSoon(); render(); }
      return;
    }
    const cu = t.closest('[data-clup]');
    if (cu) { const [s, id] = cu.dataset.clup.split('|'); const L = D.checklist.template[s]; const i = L.findIndex(x => x.id === id); if (i > 0) [L[i - 1], L[i]] = [L[i], L[i - 1]]; saveSoon(); render(); return; }
    const cd = t.closest('[data-cldel]');
    if (cd) { const [s, id] = cd.dataset.cldel.split('|'); D.checklist.template[s] = D.checklist.template[s].filter(x => x.id !== id); saveSoon(); render(); return; }

    const a = t.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (act === 'closeProf') { open = false; render(); }
    if (act === 'lock') { lock(); }
    if (act === 'openClasses') A.openClasses();
    if (act === 'wkPrev') { ui.week = addDays(ui.week, -7); render(); }
    if (act === 'wkNext') { ui.week = addDays(ui.week, 7); render(); }
    if (act === 'wkToday') { ui.week = mondayOf(todayISO()); render(); }
    if (act === 'cancelEdit') { ui.editLesson = null; render(); }
    if (act === 'delLesson') { if (await A.confirmBox(T('delLessonQ'), T('delete'))) { D.lessons = D.lessons.filter(l => l.id !== ui.editLesson); ui.editLesson = null; saveSoon(); render(); } }
    if (act === 'absToday') { ui.absDate = todayISO(); render(); }
    if (act === 'allPresent') { const all = D.absences[ui.cls] = D.absences[ui.cls] || {}; all[ui.absDate] = {}; if (ui.absDate === todayISO()) { A.state.presence[ui.cls] = { date: todayISO(), absent: [] }; A.save(); } saveSoon(); render(); }
    if (act === 'absCsv') {
      const cls = A.classById(ui.cls); const all = D.absences[cls.id] || {}; const dates = Object.keys(all).sort();
      const rows = [[T('student'), ...dates, T('st_A'), T('st_R'), T('st_E')]];
      cls.students.forEach(s => { const c = { A: 0, R: 0, E: 0 }; const r = dates.map(d => { const v = all[d][s.id]; if (v) c[v]++; return v ? T('st_' + v) : ''; }); rows.push([s.name, ...r, c.A, c.R, c.E]); });
      A.download(`${T('p_absences')}-${cls.name}-${todayISO()}.csv`, csv(rows), 'text/csv;charset=utf-8');
    }
    if (act === 'gradesCsv') {
      const cls = A.classById(ui.cls); const G = D.grades[cls.id];
      const rows = [[T('student'), ...G.evals.flatMap(ev => ev.type === 'points' ? [`${ev.title} (${T('points')})`, `${ev.title} (${T('grade')})`] : [ev.title]), T('average')]];
      cls.students.forEach(s => rows.push([s.name, ...G.evals.flatMap(ev => { const raw = (G.marks[ev.id] || {})[s.id]; const g = gradeOf(ev, raw); return ev.type === 'points' ? [raw ?? '', g === null ? '' : g] : [raw ?? '']; }), (x => x === null ? '' : Math.round(x * 100) / 100)(average(G, s.id))]));
      A.download(`${T('p_grades')}-${cls.name}-${todayISO()}.csv`, csv(rows), 'text/csv;charset=utf-8');
    }
    if (act === 'clToday') { ui.clDate = todayISO(); render(); }
    if (act === 'clEdit') { ui.clEdit = !ui.clEdit; render(); }
    if (act === 'clReset') { if (await A.confirmBox(T('clResetQ'))) { D.checklist.template = defaultTemplate(); saveSoon(); render(); } }
    if (act === 'clUncheck') { delete D.checklist.done[ui.clDate + '|' + (ui.cls || '')]; saveSoon(); render(); }
    if (act === 'backup') { await persist(); const S = A.state; A.download(`didac-tableau-${todayISO()}.json`, JSON.stringify({ app: 'didac-tableau', v: 1, date: new Date().toISOString(), state: S, vault: LS.get(VKEY, null), docs: await window.DidacDocs.exportAll() })); }
    if (act === 'wipe') { if (await A.confirmBox(T('wipeQ'), T('wipe'))) { localStorage.removeItem(VKEY); try { await idbClear(); } catch (e) { } key = null; D = null; render(); } }
  });
}
function importFile(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = async () => {
    try {
      const d = JSON.parse(r.result); if (d.app !== 'didac-tableau' || !d.vault) throw new Error('format');
      if (!(await A.confirmBox(T('importQ')))) return;
      LS.set(VKEY, d.vault); if (d.state) { LS.set('didac-tableau-v1', d.state); }
      if (d.docs) await window.DidacDocs.importAll(d.docs);
      location.reload();
    } catch (e) { A.openDlg(`<h2>${T('error')}</h2><p>${T('importErr')}</p><div class="row row--end"><button class="btn" data-act="closeDlg">${T('ok')}</button></div>`); }
  };
  r.readAsText(file);
}
})();
