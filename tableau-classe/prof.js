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
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
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
function saveSoon() { clearTimeout(saveT); saveT = setTimeout(persist, 400); }
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
  salt = crypto.getRandomValues(new Uint8Array(16));
  key = await deriveKey(pw, salt, iter); await persist();
}
function lock() { clearTimeout(saveT); if (key && D) persist(); key = null; D = null; render(); }
function normalize(d) {
  d.lessons = d.lessons || [];
  d.absences = d.absences || {};
  d.grades = d.grades || {};
  d.checklist = d.checklist || { template: defaultTemplate(), done: {} };
  d.settings = d.settings || { rounding: 0.5 };
  return d;
}
function defaultTemplate() {
  const mk = (sec, n) => Array.from({ length: n }, (_, i) => ({ id: `${sec}${i + 1}`, key: `cl_${sec}${i + 1}` }));
  return { before: mk('b', 5), during: mk('d', 5), after: mk('a', 5) };
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
  const tabs = [['agenda', 'blank-calendar'], ['absences', 'user-single-neutral-male'], ['grades', 'trophy'], ['checklist', 'check-square'], ['settings', 'information-circle']];
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
  const L = D.lessons.filter(l => l.date >= ui.week && l.date <= end && (!ui.filterAll ? l.classId === ui.cls : true)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const ed = ui.editLesson ? D.lessons.find(l => l.id === ui.editLesson) : null;
  const hw = D.lessons.filter(l => l.homework && l.date >= addDays(todayISO(), -14) && (ui.filterAll || l.classId === ui.cls)).sort((a, b) => a.date.localeCompare(b.date));
  const days = {}; L.forEach(l => (days[l.date] = days[l.date] || []).push(l));
  const cname = id => (A.classById(id) || { name: '—' }).name;
  return `<div class="row">${classPicker()}<label class="chk"><input type="checkbox" data-role="allcls" ${ui.filterAll ? 'checked' : ''}> ${T('allClasses')}</label></div>
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
          <div class="row"><button class="btn btn--ghost btn--s" data-editl="${l.id}">${T('edit')}</button><button class="btn btn--ghost btn--s" data-checkl="${l.id}">${T('p_checklist')}</button></div></div>`).join('')}`).join('')
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
  const evs = S.events.slice().sort((a, c) => a.date.localeCompare(c.date));
  return `<form class="card" data-role="eventform"><h3>${T('events')}</h3>
    <div class="row"><label class="field" style="flex:1;min-width:150px"><span>${T('eventName')}</span><input class="inp" name="title" required placeholder="${T('eventPh')}"></label>
      <label class="field"><span>${T('eventDate')}</span><input class="inp" type="datetime-local" name="date" required></label>
      <button class="btn" style="align-self:end">${T('add')}</button></div>
    ${evs.length ? evs.map(e => `<div class="lesson" style="border-left-color:${e.date < now ? 'var(--d-gris2)' : 'var(--d-blau)'}"><div class="lesson-top"><b>${esc(e.title)}</b><span class="tag">${new Date(e.date).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
      <div class="row"><button type="button" class="btn btn--s" data-evshow="${e.id}">${T('showCountdown')}</button><button type="button" class="btn btn--ghost btn--s" data-evdel="${e.id}">${T('delete')}</button></div></div>`).join('') : `<p class="lbl-s" style="margin:0">${T('noEvents')}</p>`}
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
    ${G.evals.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${T('student')}</th>
      ${G.evals.map(ev => `<th class="num">${esc(ev.title)}<br><span class="lbl-s">${ev.date ? fmtDate(ev.date, { day: 'numeric', month: 'short' }) : ''} · ${ev.type === 'grade' ? T('typeGrade') : '/' + ev.max} · ×${ev.weight}</span><br><button class="w-x" data-delev="${ev.id}" title="${T('delete')}" aria-label="${T('delete')}">×</button></th>`).join('')}
      <th class="num">${T('average')}</th></tr></thead><tbody>
      ${cls.students.map(s => { const av = average(G, s.id); return `<tr><td>${esc(s.name)}</td>${G.evals.map(ev => { const raw = (G.marks[ev.id] || {})[s.id]; const g = gradeOf(ev, raw); return `<td class="num"><input class="inp" inputmode="decimal" data-ev="${ev.id}" data-stu="${s.id}" value="${raw ?? ''}" aria-label="${esc(s.name)} – ${esc(ev.title)}">${ev.type === 'points' ? `<div class="lbl-s" data-gout="${ev.id}|${s.id}">${fmtG(g)}</div>` : ''}</td>`; }).join('')}
        <td class="num avg ${av === null ? '' : av < 4 ? 'mark-bad' : 'mark-ok'}" data-avg="${s.id}">${fmtG(av)}</td></tr>`; }).join('')}
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
  <div class="grid3">${SECS.map(([s, c]) => `<div class="cl-col ${c}"><h4>${T('cl_' + s)}</h4>
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

/* ---------- CSV ---------- */
const csvCell = v => { v = String(v ?? ''); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const csv = rows => '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');

/* ---------- Évènements ---------- */
function bind() {
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
      if (cell) { cell.textContent = fmtG(av); cell.className = 'num avg ' + (av === null ? '' : av < 4 ? 'mark-bad' : 'mark-ok'); }
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
    if (act === 'backup') { await persist(); const S = A.state; A.download(`didac-tableau-${todayISO()}.json`, JSON.stringify({ app: 'didac-tableau', v: 1, date: new Date().toISOString(), state: S, vault: LS.get(VKEY, null) })); }
    if (act === 'wipe') { if (await A.confirmBox(T('wipeQ'), T('wipe'))) { localStorage.removeItem(VKEY); key = null; D = null; render(); } }
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
      location.reload();
    } catch (e) { A.openDlg(`<h2>${T('error')}</h2><p>${T('importErr')}</p><div class="row row--end"><button class="btn" data-act="closeDlg">${T('ok')}</button></div>`); }
  };
  r.readAsText(file);
}
})();
