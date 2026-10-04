/* Biblioteca: the whole front end. Hash routes, one view per section.
   Data lives on this device; local-api.js answers the same routes a server would. */
import { start, call, download, flushed } from "./local-api.js";
import { readXlsx } from "./xlsx.js";
import { COLORS } from "./registry.js";

// ── small helpers ─────────────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const main = $("#main");

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (name) => `<svg aria-hidden="true"><use href="icons.svg#i-${name}"/></svg>`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

class ApiError extends Error {
  constructor(data, status) { super(data.error || "Algo salió mal."); this.data = data; this.status = status; }
}

async function api(method, path, body) {
  try {
    return await call(method, path, body);
  } catch (err) {
    throw new ApiError(err.data || { error: "Algo salió mal." }, err.status || 500);
  }
}

// Dates arrive as ISO "2026-10-17"; she reads them as 17/10.
// Local date (not UTC) until the registry answers with its own.
let TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dayDiff = (iso) => Math.round((Date.parse(iso) - Date.parse(TODAY)) / 86400000);
function fmtDay(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const thisYear = TODAY.slice(0, 4) === y;
  return thisYear ? `${d}/${m}` : `${d}/${m}/${y}`;
}
function fmtRel(iso) {
  const n = dayDiff(iso);
  if (n === 0) return "hoy";
  if (n === 1) return "mañana";
  if (n === -1) return "ayer";
  return fmtDay(iso);
}
const fmtDM = (iso) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const weekday = (iso) => WEEKDAYS[new Date(`${iso}T12:00:00`).getDay()];
// "17/10", "17-10", "17/10/2027" -> ISO. Without a year, a date already past means next year.
function parseDM(text) {
  const m = String(text).trim().match(/^(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?:\s*[\/\-.]\s*(\d{2}|\d{4}))?$/);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]);
  let y = m[3] ? Number(m[3].length === 2 ? "20" + m[3] : m[3]) : Number(TODAY.slice(0, 4));
  const iso = (yy) => `${yy}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const ok = (s) => { const t = new Date(`${s}T12:00:00`); return t.getDate() === d && t.getMonth() + 1 === mo; };
  if (!ok(iso(y))) return null;
  if (!m[3] && iso(y) < TODAY) y += 1;
  return iso(y);
}
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

// A book's forro colour is its age band, like the sticker on the real book; grey until she sets one.
// The print comes from the id, so two books of the same band still look different.
const FORRO_BY_COLOR = { azul: "cobalto", rojo: "tomate", verde: "pasto" };
const PRINTS = ["dots", "stripes", "stars", "checks", "waves", "plain"];
// book: a book ({id, color}) or anything that carries one ({book_id, color}).
function forro(book) {
  const n = Number(book.book_id ?? book.id) || 0;
  const name = FORRO_BY_COLOR[book.color] || "gris";
  return { style: `--c: var(--f-${name});`, print: PRINTS[(n * 7 + 1) % PRINTS.length], name };
}
const forroAttrs = (book) => { const f = forro(book); return `style="${f.style}" data-print="${f.print}" data-color="${book.color || ""}"`; };
const colorName = (color) => (color ? color[0].toUpperCase() + color.slice(1) : "Sin color");
// Radio pills: Azul 0 a 7 · Rojo 7 a 10 · Verde 10 a 12 · Sin color.
function colorPicks(current = "") {
  return `<fieldset class="field color-field"><legend>Color (edad)</legend><div class="color-picks">
    ${["azul", "rojo", "verde", ""].map((c) => `<label class="color-pick"><input type="radio" name="color" value="${c}" ${c === (current || "") ? "checked" : ""} data-testid="color-${c || "none"}">
      <span class="forro swatch" style="--c: var(--f-${FORRO_BY_COLOR[c] || "gris"})" data-print="plain"></span>
      <span>${c ? `<strong>${colorName(c)}</strong> ${COLORS[c].replace(" años", "")}` : "<strong>Sin color</strong>"}</span></label>`).join("")}
  </div></fieldset>`;
}
// Avatars carry white initials, so only the dark forro inks are used for them.
const AVATAR_INKS = ["cobalto", "tomate", "pasto", "violeta", "turquesa", "rosa"];
const studentColor = (id) => `--c: var(--f-${AVATAR_INKS[(Number(id) * 5 + 1) % AVATAR_INKS.length]})`;
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

const studentHref = (id) => `#/alumnos/${id}`;
const bookHref = (id) => `#/libros/${id}`;

// ── toasts ────────────────────────────────────────────────────────────
function toast(message, { action, label = "Deshacer", error = false, ms = 7000 } = {}) {
  const el = document.createElement("div");
  el.className = "toast" + (error ? " is-error" : "");
  el.setAttribute("role", error ? "alert" : "status");
  el.innerHTML = `<p>${esc(message)}</p>`;
  if (action) {
    const b = document.createElement("button");
    b.className = "btn btn-sm";
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", async () => { el.remove(); await action(); });
    el.append(b);
  }
  const stack = $(".toasts");
  stack.append(el);
  // A queue of children means many toasts: keep only the newest three.
  while (stack.children.length > 3) stack.firstElementChild.remove();
  setTimeout(() => el.remove(), ms);
}
const fail = (err) => toast(err.message, { error: true });

// ── shared summary (header badge, demo strip, settings) ───────────────
let summary = null;
async function refreshSummary() {
  summary = await api("GET", "/api/summary");
  TODAY = summary.today;
  $("[data-testid=library-name]").textContent = summary.settings.library_name;
  document.title = summary.settings.library_name;
  const badge = $("[data-testid=overdue-count]");
  badge.hidden = !summary.overdue;
  badge.textContent = summary.overdue;
  badge.setAttribute("aria-label", plural(summary.overdue, "atrasado", "atrasados"));
  $("[data-testid=demo-strip]").hidden = !summary.has_demo;
  return summary;
}

// ── combobox: type-ahead used at the counter ──────────────────────────
// fetcher(q) -> items; render(item) -> html; onPick(item). Enter picks the highlighted (or only) option.
function combobox(input, { fetcher, render, onPick, emptyText }) {
  const list = document.createElement("ul");
  list.className = "listbox";
  list.id = input.id + "-list";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  input.after(list);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", list.id);
  input.autocomplete = "off";
  let items = [], active = 0, seq = 0;

  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); };
  const paint = () => {
    if (!items.length) {
      list.innerHTML = `<li class="empty" role="presentation">${esc(emptyText(input.value))}</li>`;
    } else {
      list.innerHTML = items.map((it, i) => `<li role="option" id="${list.id}-${i}" aria-selected="${i === active}" data-i="${i}">${render(it)}</li>`).join("");
      input.setAttribute("aria-activedescendant", `${list.id}-${active}`);
    }
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  const load = async () => {
    const mine = ++seq;
    const q = input.value.trim();
    if (!q) { items = []; close(); return; }
    const got = await fetcher(q).catch(() => []);
    if (mine !== seq) return;
    items = got; active = 0; paint();
  };
  const pick = (i) => { const it = items[i]; if (!it) return; close(); onPick(it); };

  input.addEventListener("input", load);
  input.addEventListener("focus", () => { if (input.value.trim()) load(); });
  input.addEventListener("keydown", async (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.hidden) return load();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(items.length, 1);
      paint();
      $(`#${list.id}-${active}`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      // A barcode scanner types fast and hits Enter: make sure we searched the full code first.
      await load();
      pick(active);
    } else if (e.key === "Escape") {
      close();
    }
  });
  // Keep focus in the field while choosing (desktop); the pick itself happens on click,
  // which is also what a finger tap on the iPad produces.
  list.addEventListener("mousedown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) { e.preventDefault(); pick(Number(li.dataset.i)); }
  });
  input.addEventListener("blur", () => setTimeout(close, 300));
  return { close };
}

// ── pieces ────────────────────────────────────────────────────────────
function etiqueta(loan, { write = false } = {}) {
  return `<div class="etiqueta ${loan.overdue ? "is-late" : ""}" style="--c: var(--f-${forro(loan).name})">
    <div class="etiqueta-line"><span>Nombre</span><span class="hand ${write ? "write" : ""}">${esc(loan.student)}</span></div>
    <div class="etiqueta-line"><span>Grado</span><span class="hand ${write ? "write" : ""}">${esc(loan.grade || "—")}</span></div>
    <div class="etiqueta-line"><span>Vuelve</span><span class="hand due ${write ? "write" : ""}">${esc(fmtRel(loan.due_on))}</span></div>
  </div>`;
}

function loanTile(loan, { tag = "a", animate = false } = {}) {
  const href = tag === "a" ? `href="${studentHref(loan.student_id)}"` : "";
  const label = `${loan.title}, lo tiene ${loan.student}${loan.grade ? " de " + loan.grade : ""}, vuelve ${fmtRel(loan.due_on)}${loan.overdue ? ", atrasado" : ""}`;
  return `<${tag} ${href} class="forro loan-tile ${animate ? "just-lent" : ""}" ${forroAttrs(loan)} aria-label="${esc(label)}" data-testid="loan-tile">
    ${loan.overdue ? `<span class="late-flag">${plural(loan.days_late, "día", "días")} tarde</span>` : ""}
    <span class="tile-title">${esc(loan.title)}</span>
    <span class="tile-code">${esc(loan.code)}</span>
    ${etiqueta(loan, { write: animate })}
  </${tag}>`;
}

function statusPill(copy, archived) {
  if (archived || copy.archived) return `<span class="pill pill-off">Dado de baja</span>`;
  if (!copy.loan) return `<span class="pill pill-ok">En la biblioteca</span>`;
  if (copy.loan.overdue) return `<span class="pill pill-late">Atrasado</span>`;
  return `<span class="pill pill-out">Prestado</span>`;
}

function loanSentence(l) {
  const who = `<a class="student-link" href="${studentHref(l.student_id)}">${esc(l.student)}</a>${l.grade ? ` (${esc(l.grade)})` : ""}`;
  return l.overdue
    ? `lo tiene ${who}, <span class="late-days">venció el ${fmtDay(l.due_on)} (${plural(l.days_late, "día", "días")} de atraso)</span>`
    : `lo tiene ${who}, vuelve ${fmtRel(l.due_on) === fmtDay(l.due_on) ? "el " + fmtDay(l.due_on) : fmtRel(l.due_on)}`;
}

function loading(rows = 3) {
  main.innerHTML = `<div style="display:grid;gap:16px">${'<div class="skeleton" style="height:64px"></div>'.repeat(rows)}</div>`;
}

// ══ MOSTRADOR ══════════════════════════════════════════════════════════
const desk = { mode: "lend", student: null, copy: null };

async function viewMostrador(params) {
  await refreshSummary();
  if (params.get("alumno")) {
    try { desk.student = await api("GET", `/api/students/${params.get("alumno")}`); desk.mode = "lend"; } catch { /* stale link */ }
  }
  const empty = !summary.books && !summary.students;
  main.innerHTML = `
    <h1 class="sr-only">Mostrador</h1>
    ${empty ? firstRun() : backupNudge()}
    <div class="desk">
      <section class="counter" aria-label="Préstamos y devoluciones">
        <div class="switch" role="tablist" aria-label="Qué hacer">
          <button type="button" role="tab" id="tab-lend" aria-selected="${desk.mode === "lend"}" data-mode="lend">${icon("book-marked")}Prestar</button>
          <button type="button" role="tab" id="tab-return" aria-selected="${desk.mode === "return"}" data-mode="return">${icon("undo-2")}Devolver</button>
        </div>
        <div id="counter-body" role="tabpanel"></div>
        <div id="counter-result" aria-live="polite"></div>
      </section>
      <section class="panel ask" aria-labelledby="ask-h">
        <h2 id="ask-h">Preguntá</h2>
        <form id="ask-form" role="search">
          <label class="input-icon">${icon("search")}
            <input class="input" id="ask-q" name="q" type="search" placeholder="Libro, alumno, clase o código" aria-label="Pregunta" data-testid="ask-input">
          </label>
        </form>
        <div class="chips" aria-label="Preguntas rápidas">
          <button type="button" class="chip" data-ask="atrasados">${icon("triangle-alert")}Atrasados</button>
          <button type="button" class="chip" data-ask="prestados">Prestados ahora</button>
          <button type="button" class="chip" data-ask="hoy">Prestados hoy</button>
          <button type="button" class="chip" data-ask="más leídos">${icon("sparkles")}Más leídos</button>
          ${summary.grades.slice(0, 8).map((g) => `<button type="button" class="chip" data-ask="${esc(g)}">${esc(g)}</button>`).join("")}
        </div>
        <div class="ask-answer" id="answer" aria-live="polite" data-testid="answer"></div>
      </section>
    </div>
    <section class="section" aria-labelledby="out-h">
      <h2 id="out-h">Prestados ahora <small id="out-count"></small></h2>
      <div id="out-tiles"></div>
    </section>`;

  $$(".switch button").forEach((b) => b.addEventListener("click", () => { desk.mode = b.dataset.mode; viewMostrador(new URLSearchParams()); }));
  $("[data-testid=backup-nudge] [data-download]")?.addEventListener("click", async () => {
    const name = download("backup");
    await flushed();
    toast(`Listo: ${name} quedó en Descargas (app Archivos).`);
    viewMostrador(new URLSearchParams());
  });
  renderCounter();
  wireAsk();
  renderOut();
  wireFirstRun();
}

// Everything lives only on this iPad, so a weekly copy is the safety net.
function backupNudge() {
  if (summary.has_demo) return "";
  const days = summary.last_backup ? -dayDiff(summary.last_backup) : null;
  if (days !== null && days < 7) return "";
  return `<div class="notice notice-warn backup-nudge" data-testid="backup-nudge">
    <p>${days === null ? "Todavía no guardaste ninguna copia de seguridad." : `Hace ${plural(days, "día", "días")} que no guardás una copia de seguridad.`} Todo está solo en este iPad.</p>
    <div class="row"><button type="button" class="btn btn-go btn-sm" data-download="backup">${icon("download")}Guardar copia ahora</button></div>
  </div>`;
}

function firstRun() {
  return `<div class="empty-state" style="margin-bottom:24px" data-testid="first-run">
    <h3>¡Hola! La biblioteca está vacía</h3>
    <p>Primero cargá los alumnos y los libros (podés traerlos de una planilla de Excel), o probá la app con datos de ejemplo.</p>
    <div class="row">
      <a class="btn btn-go" href="#/ajustes">${icon("upload")}Cargar desde Excel</a>
      <button type="button" class="btn btn-line" data-action="load-demo">${icon("sparkles")}Probar con datos de ejemplo</button>
    </div>
    <p>¿Primera vez? Mirá <a href="#/ayuda">cómo se usa</a>, paso por paso.</p>
  </div>`;
}
function wireFirstRun() {
  $("[data-action=load-demo]")?.addEventListener("click", async (e) => {
    e.currentTarget.classList.add("is-busy");
    try { await api("POST", "/api/demo"); toast("Listo: cargué libros, alumnos y préstamos de ejemplo."); route(); } catch (err) { fail(err); }
  });
}

function renderCounter() {
  const body = $("#counter-body");
  if (desk.mode === "lend") {
    const due = addDays(TODAY, summary.settings.loan_days);
    body.innerHTML = `
      <form id="lend-form" class="label-form forro" data-print="stars" style="--c: var(--f-cobalto)" novalidate>
        <div class="etiqueta etiqueta-form" style="--c: var(--f-cobalto)">
          <div class="label-row combo"><span class="label-key" id="l-student-label">Nombre</span><div id="student-slot"></div></div>
          <div class="label-row combo"><span class="label-key" id="l-book-label">Libro</span><div id="copy-slot"></div></div>
          <div class="label-row"><label class="label-key" for="l-due">Vuelve</label>
            <div class="due-line">
              <input class="line-input hand due-input" id="l-due" value="${fmtDM(due)}" inputmode="numeric" autocomplete="off" aria-describedby="l-due-day" data-testid="lend-due">
              <span class="due-day" id="l-due-day">${weekday(due)}</span>
              <span class="chips due-chips" aria-label="Plazos rápidos">${[7, 14, 21].map((d) => `<button type="button" class="chip chip-sm" data-days="${d}" aria-pressed="${d === summary.settings.loan_days}">${d / 7} ${d === 7 ? "semana" : "semanas"}</button>`).join("")}</span>
            </div>
          </div>
        </div>
        <button class="btn btn-go btn-big" type="submit" data-testid="lend-submit">${icon("check")}Prestar</button>
      </form>
      <div id="lend-notice"></div>`;
    paintStudentSlot();
    paintCopySlot();
    wireDueLine($("#l-due"), $("#l-due-day"), $$(".due-chips .chip"));
    $("#lend-form").addEventListener("submit", (e) => { e.preventDefault(); doLend(false); });
  } else {
    body.innerHTML = `
      <div class="label-form forro" data-print="stars" style="--c: var(--f-cobalto)">
        <div class="etiqueta etiqueta-form" style="--c: var(--f-cobalto)">
          <div class="label-row combo"><label class="label-key" for="r-q">Libro</label>
            <input class="line-input hand" id="r-q" placeholder="código, título o alumno" data-testid="return-input"></div>
          <p class="label-help">Elegí el libro de la lista, o escaneá el código y apretá Enter.</p>
        </div>
      </div>
      <div id="return-notice"></div>`;
    combobox($("#r-q"), {
      fetcher: (q) => api("GET", `/api/suggest/copies?mode=return&q=${encodeURIComponent(q)}`),
      render: (c) => `<span class="forro swatch" ${forroAttrs(c)}></span>
        <span><span class="opt-main">${esc(c.title)}</span> <span class="code">${esc(c.code)}</span><br>
        <span class="opt-sub">lo tiene ${esc(c.student)}${c.grade ? ` (${esc(c.grade)})` : ""} · vuelve ${esc(fmtRel(c.due_on))}</span></span>`,
      emptyText: (q) => `Ningún libro prestado coincide con «${q}».`,
      onPick: (c) => doReturn(c.code),
    });
    $("#r-q").focus();
  }
}

// The "Vuelve" line: typed as dd/mm, with quick 1/2/3-week picks and the weekday spelled out.
function wireDueLine(input, dayEl, chips) {
  const sync = () => {
    const iso = parseDM(input.value);
    dayEl.textContent = iso ? weekday(iso) : "escribila como 17/10";
    input.setAttribute("aria-invalid", String(!iso));
    chips.forEach((c) => c.setAttribute("aria-pressed", String(iso === addDays(TODAY, Number(c.dataset.days)))));
  };
  input.addEventListener("input", sync);
  chips.forEach((c) => c.addEventListener("click", () => { input.value = fmtDM(addDays(TODAY, Number(c.dataset.days))); sync(); }));
}

function clearLastResult() { const r = $("#counter-result"); if (r) r.innerHTML = ""; }

function paintStudentSlot() {
  const slot = $("#student-slot");
  if (desk.student) {
    const s = desk.student;
    const n = s.loans ? s.loans.length : s.open_loans;
    slot.innerHTML = `<div class="picked-line" data-testid="picked-student">
      <span class="hand picked-hand">${esc(s.name)}</span>
      <span class="picked-meta">${esc(s.grade || "")}${n ? ` · tiene ${plural(n, "libro", "libros")}` : ""}</span>
      <button type="button" class="btn btn-quiet btn-sm" aria-label="Cambiar alumno">${icon("x")}</button></div>`;
    $("button", slot).addEventListener("click", () => { desk.student = null; paintStudentSlot(); $("#l-student").focus(); });
    return;
  }
  slot.innerHTML = `<input class="line-input hand" id="l-student" placeholder="nombre o clase" aria-labelledby="l-student-label" data-testid="lend-student">`;
  combobox($("#l-student"), {
    fetcher: (q) => api("GET", `/api/suggest/students?q=${encodeURIComponent(q)}`),
    render: (s) => `<span class="avatar" style="${studentColor(s.id)};width:30px;height:30px;font-size:.8rem">${esc(initials(s.name))}</span>
      <span><span class="opt-main">${esc(s.name)}</span><br><span class="opt-sub">${esc(s.grade || "sin clase")}${s.open_loans ? ` · tiene ${plural(s.open_loans, "libro", "libros")}` : ""}${s.overdue ? " · con atraso" : ""}</span></span>`,
    emptyText: (q) => `No hay ningún alumno «${q}». Agregalo en Alumnos.`,
    onPick: (s) => { desk.student = s; clearLastResult(); paintStudentSlot(); (desk.copy ? $("[data-testid=lend-submit]") : $("#l-copy"))?.focus(); },
  });
}

function paintCopySlot() {
  const slot = $("#copy-slot");
  if (desk.copy) {
    const c = desk.copy;
    slot.innerHTML = `<div class="picked-line" data-testid="picked-copy">
      <span class="forro swatch" ${forroAttrs(c)}></span>
      <span class="hand picked-hand">${esc(c.title)}</span>
      <span class="picked-meta">${esc(c.code)}</span>
      <button type="button" class="btn btn-quiet btn-sm" aria-label="Cambiar libro">${icon("x")}</button></div>`;
    $("button", slot).addEventListener("click", () => { desk.copy = null; paintCopySlot(); $("#l-copy").focus(); });
    return;
  }
  slot.innerHTML = `<input class="line-input hand" id="l-copy" placeholder="título o código" aria-labelledby="l-book-label" data-testid="lend-book">`;
  combobox($("#l-copy"), {
    fetcher: (q) => api("GET", `/api/suggest/copies?mode=lend&q=${encodeURIComponent(q)}`),
    render: (c) => `<span class="forro swatch" ${forroAttrs(c)}></span>
      <span><span class="opt-main">${esc(c.title)}</span> <span class="code">${esc(c.code)}</span><br><span class="opt-sub">${esc(c.author || "")}</span></span>`,
    emptyText: (q) => `No hay ejemplares disponibles de «${q}». Si es un libro nuevo, agregalo en Libros.`,
    onPick: (c) => { desk.copy = c; clearLastResult(); paintCopySlot(); (desk.student ? $("[data-testid=lend-submit]") : $("#l-student"))?.focus(); },
  });
}

async function doLend(force) {
  const notice = $("#lend-notice");
  notice.innerHTML = "";
  if (!desk.student || !desk.copy) {
    notice.innerHTML = `<div class="notice notice-error" role="alert">${!desk.student ? "Elegí a quién se lo prestás." : "Elegí qué libro se lleva."}</div>`;
    (!desk.student ? $("#l-student") : $("#l-copy"))?.focus();
    return;
  }
  const dueOn = parseDM($("#l-due").value);
  if (!dueOn) {
    notice.innerHTML = `<div class="notice notice-error" role="alert">No entendí la fecha de vuelta. Escribila como 17/10.</div>`;
    $("#l-due").focus();
    return;
  }
  const btn = $("[data-testid=lend-submit]");
  btn.classList.add("is-busy");
  try {
    const loan = await api("POST", "/api/loans", { code: desk.copy.code, student_id: desk.student.id, due_on: dueOn, force });
    desk.student = null; desk.copy = null;
    renderCounter();
    showLent(loan);
    renderOut();
    refreshSummary();
    $("#l-student")?.focus();
  } catch (err) {
    btn.classList.remove("is-busy");
    const d = err.data || {};
    if (d.code === "needs_confirmation") {
      notice.innerHTML = `<div class="notice notice-warn" role="alert" data-testid="lend-warning"><p>${esc(err.message)}</p>
        <div class="row"><button type="button" class="btn btn-go btn-sm" data-act="force">Prestar igual</button>
        <button type="button" class="btn btn-quiet btn-sm" data-act="cancel">Cancelar</button></div></div>`;
      $("[data-act=force]", notice).addEventListener("click", () => doLend(true));
      $("[data-act=cancel]", notice).addEventListener("click", () => { notice.innerHTML = ""; });
      $("[data-act=force]", notice).focus();
    } else if (d.code === "copy_on_loan") {
      notice.innerHTML = `<div class="notice notice-warn" role="alert"><p>${esc(err.message)} Si ya lo devolvió, registrá la devolución y se lo prestás a ${esc(desk.student.name)}.</p>
        <div class="row"><button type="button" class="btn btn-go btn-sm" data-act="swap">Registrar devolución y prestar</button></div></div>`;
      $("[data-act=swap]", notice).addEventListener("click", async () => {
        try { await api("POST", "/api/returns", { code: desk.copy.code }); doLend(false); } catch (e) { fail(e); }
      });
    } else {
      notice.innerHTML = `<div class="notice notice-error" role="alert">${esc(err.message)}</div>`;
    }
  }
}

function showLent(loan) {
  $("#counter-result").innerHTML = `<div class="result" data-testid="lend-result">
    ${loanTile(loan, { tag: "div", animate: true })}
    <div class="result-text">
      <h3>¡Prestado!</h3>
      <p><strong>${esc(loan.title)}</strong> se va con ${esc(loan.student)}${loan.grade ? ` (${esc(loan.grade)})` : ""}.</p>
      <p class="muted">Tiene que volver el ${fmtDay(loan.due_on)}.</p>
    </div></div>`;
}

async function doReturn(code) {
  const notice = $("#return-notice");
  try {
    const loan = await api("POST", "/api/returns", { code });
    const late = dayDiff(loan.due_on) < 0 ? -dayDiff(loan.due_on) : 0;
    notice.innerHTML = `<div class="notice notice-ok" data-testid="return-result"><p><strong>${esc(loan.title)}</strong> (${esc(loan.code)}) volvió a la biblioteca. Lo tenía ${esc(loan.student)}${loan.grade ? ` (${esc(loan.grade)})` : ""}.
      ${late ? `<br><span class="late-days">Volvió con ${plural(late, "día", "días")} de atraso.</span>` : ""}</p></div>`;
    $("#r-q").value = "";
    $("#r-q").focus();
    toast(`Devuelto: ${loan.title}`, { action: () => undoReturn(loan) });
    renderOut();
    refreshSummary();
  } catch (err) {
    notice.innerHTML = `<div class="notice notice-error" role="alert">${esc(err.message)}</div>`;
  }
}

async function undoReturn(loan) {
  try {
    await api("POST", `/api/loans/${loan.id}/undo-return`);
    toast(`Listo, ${loan.title} figura otra vez prestado a ${loan.student}.`);
    route();
  } catch (err) { fail(err); }
}

async function renderOut() {
  if (!$("#out-tiles")) return;
  const loans = await api("GET", "/api/loans");
  // The page may have been re-rendered while we waited: paint whatever is there now.
  const box = $("#out-tiles");
  if (!box) return;
  $("#out-count").textContent = loans.length ? plural(loans.length, "libro", "libros") : "";
  box.innerHTML = loans.length
    ? `<div class="tiles">${loans.map((l) => loanTile(l)).join("")}</div>`
    : `<div class="empty-state"><h3>Todos los libros están en su lugar</h3><p>Cuando prestes uno, va a aparecer acá con su etiqueta.</p></div>`;
}

// ── preguntas ─────────────────────────────────────────────────────────
function wireAsk() {
  const input = $("#ask-q");
  let t;
  const run = async (q) => {
    $$(".chip[data-ask]").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.ask === q)));
    if (!q.trim()) { $("#answer").innerHTML = ""; return; }
    try { renderAnswer(await api("GET", `/api/ask?q=${encodeURIComponent(q)}`)); } catch (err) { fail(err); }
  };
  input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => run(input.value), 220); });
  $("#ask-form").addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(t); run(input.value); });
  $$(".chip[data-ask]").forEach((c) => c.addEventListener("click", () => { input.value = c.dataset.ask; run(c.dataset.ask); }));
}

function loanLines(loans, { showBook = true } = {}) {
  return `<ul class="lines">${loans.map((l) => `<li>
    ${showBook ? `<span class="forro swatch" ${forroAttrs(l)} style="width:16px;height:22px;${forro(l).style}"></span><a href="${bookHref(l.book_id)}"><strong>${esc(l.title)}</strong></a> <span class="code">${esc(l.code)}</span>` : ""}
    <span>${loanSentence(l)}</span></li>`).join("")}</ul>`;
}

function renderAnswer(a) {
  const box = $("#answer");
  if (a.kind === "overdue") {
    box.innerHTML = a.loans.length
      ? `<p class="answer-lead">Hay ${plural(a.loans.length, "libro atrasado", "libros atrasados")}.</p>${loanLines(a.loans)}<p><a href="#/atrasados">Ver la lista para imprimir</a></p>`
      : `<p class="answer-lead">No hay nada atrasado. ¡Todos al día!</p>`;
  } else if (a.kind === "open") {
    box.innerHTML = `<p class="answer-lead">${a.loans.length ? `Hay ${plural(a.loans.length, "libro prestado", "libros prestados")}.` : "No hay libros prestados."}</p>${loanLines(a.loans)}`;
  } else if (a.kind === "today") {
    box.innerHTML = `<p class="answer-lead">${a.loans.length ? `Hoy se prestaron ${plural(a.loans.length, "libro", "libros")}.` : "Hoy todavía no se prestó ningún libro."}</p>${loanLines(a.loans)}`;
  } else if (a.kind === "top") {
    box.innerHTML = a.books.length
      ? `<p class="answer-lead">Los más leídos:</p><ol class="lines" style="list-style:decimal;padding-left:22px">${a.books.map((b) => `<li><a href="${bookHref(b.id)}"><strong>${esc(b.title)}</strong></a><span class="muted">${esc(b.author)} · ${plural(b.times_lent, "préstamo", "préstamos")}</span></li>`).join("")}</ol>`
      : `<p class="answer-lead">Todavía no hay préstamos para armar el ranking.</p>`;
  } else if (a.kind === "grade") {
    const withBooks = new Set(a.loans.map((l) => l.student_id));
    box.innerHTML = `<p class="answer-lead">${esc(a.grade)}: ${plural(a.students.length, "alumno", "alumnos")}, ${plural(a.loans.length, "libro prestado", "libros prestados")}.</p>
      ${a.loans.length ? loanLines(a.loans) : ""}
      ${a.students.filter((s) => !withBooks.has(s.id)).length ? `<p class="muted">Sin libros: ${a.students.filter((s) => !withBooks.has(s.id)).map((s) => `<a class="student-link" href="${studentHref(s.id)}">${esc(s.name)}</a>`).join(", ")}.</p>` : ""}`;
  } else if (a.kind === "search") {
    const blocks = [];
    for (const b of a.books) {
      const active = b.copies.filter((c) => !c.archived);
      const lead = b.archived ? "Está archivado." : `${active.length === 1 ? "Tiene 1 ejemplar" : `Tiene ${active.length} ejemplares`}, ${b.available === active.length ? (active.length === 1 ? "está en la biblioteca" : "todos en la biblioteca") : b.available ? `${b.available} en la biblioteca` : "ninguno en la biblioteca"}.`;
      blocks.push(`<div class="answer-block" data-testid="answer-book">
        <div class="answer-title"><span class="forro swatch" ${forroAttrs(b)} style="width:22px;height:30px;${forro(b).style}"></span><a href="${bookHref(b.id)}">${esc(b.title)}</a><span class="muted">${esc(b.author)}</span></div>
        <p>${lead}</p>
        <ul class="lines">${active.filter((c) => c.loan).map((c) => `<li><span class="code">${esc(c.code)}</span> <span>${loanSentence(c.loan)}</span></li>`).join("")}</ul>
      </div>`);
    }
    for (const s of a.students) {
      blocks.push(`<div class="answer-block" data-testid="answer-student">
        <div class="answer-title"><span class="avatar" style="${studentColor(s.id)};width:30px;height:30px;font-size:.8rem">${esc(initials(s.name))}</span><a href="${studentHref(s.id)}">${esc(s.name)}</a><span class="muted">${esc(s.grade)}</span></div>
        ${s.loans.length
          ? `<p>Tiene ${plural(s.loans.length, "libro", "libros")}:</p><ul class="lines">${s.loans.map((l) => `<li><a href="${bookHref(l.book_id)}"><strong>${esc(l.title)}</strong></a> <span class="code">${esc(l.code)}</span> <span class="${l.overdue ? "late-days" : "muted"}">${l.overdue ? `venció el ${fmtDay(l.due_on)}` : `vuelve ${fmtRel(l.due_on)}`}</span></li>`).join("")}</ul>`
          : `<p>No tiene libros prestados.${s.times_borrowed ? ` Ya se llevó ${plural(s.times_borrowed, "libro", "libros")} en total.` : ""}</p>`}
      </div>`);
    }
    box.innerHTML = blocks.length ? blocks.join("")
      : `<p class="answer-lead">No encontré nada con «${esc(a.query)}».</p><p class="muted">Probá con parte del título, el nombre o apellido del alumno, la clase (4°B) o el código del libro (B-0012).</p>`;
  } else {
    box.innerHTML = "";
  }
}

// ══ ATRASADOS ══════════════════════════════════════════════════════════
async function viewAtrasados() {
  loading();
  const [loans] = await Promise.all([api("GET", "/api/loans?filter=overdue"), refreshSummary()]);
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Atrasados</h1><p>${loans.length ? `${plural(loans.length, "libro tendría", "libros tendrían")} que haber vuelto. Los más viejos primero.` : ""}</p></div>
      ${loans.length ? `<button type="button" class="btn btn-line no-print" onclick="window.print()">Imprimir lista</button>` : ""}
    </div>
    ${loans.length ? `<div class="table-wrap"><table class="stack-sm" data-testid="overdue-table">
      <thead><tr><th>Libro</th><th>Alumno</th><th class="hide-sm">Clase</th><th>Venció</th><th class="num">Atraso</th><th class="actions"><span class="sr-only">Acciones</span></th></tr></thead>
      <tbody>${loans.map((l) => `<tr class="is-late" data-loan="${l.id}">
        <td><div class="book-cell"><span class="forro swatch" ${forroAttrs(l)}></span><span><a href="${bookHref(l.book_id)}">${esc(l.title)}</a><br><span class="code">${esc(l.code)}</span></span></div></td>
        <td><a class="student-link" href="${studentHref(l.student_id)}">${esc(l.student)}</a></td>
        <td class="hide-sm">${esc(l.grade)}</td>
        <td data-label="Venció">${fmtDay(l.due_on)}</td>
        <td class="num"><span class="late-days">${plural(l.days_late, "día", "días")}</span></td>
        <td class="actions"><button type="button" class="btn btn-quiet btn-sm" data-renew="${l.id}">${icon("rotate-cw")}Renovar</button>
          <button type="button" class="btn btn-line btn-sm" data-return="${esc(l.code)}">Devolver</button></td>
      </tr>`).join("")}</tbody></table></div>`
      : `<div class="empty-state" data-testid="overdue-empty"><h3>¡Nada atrasado!</h3><p>Todos los libros prestados están dentro de fecha.</p></div>`}`;
  wireLoanActions();
}

function wireLoanActions(root = main) {
  $$("[data-return]", root).forEach((b) => b.addEventListener("click", async () => {
    try {
      const loan = await api("POST", "/api/returns", { code: b.dataset.return });
      toast(`Devuelto: ${loan.title}`, { action: () => undoReturn(loan) });
      route();
    } catch (err) { fail(err); }
  }));
  $$("[data-renew]", root).forEach((b) => b.addEventListener("click", async () => {
    try {
      const loan = await api("POST", `/api/loans/${b.dataset.renew}/renew`);
      toast(`Renovado: ${loan.title} vuelve el ${fmtDay(loan.due_on)}.`);
      route();
    } catch (err) { fail(err); }
  }));
  $$("[data-due]", root).forEach((inp) => inp.addEventListener("change", async () => {
    const dueOn = parseDM(inp.value);
    if (dueOn && dueOn === inp.dataset.saved) return; // one save per edit
    if (dueOn) inp.dataset.saved = dueOn;
    if (!dueOn) { inp.setAttribute("aria-invalid", "true"); toast("No entendí la fecha. Escribila como 17/10.", { error: true }); return; }
    try {
      const loan = await api("PATCH", `/api/loans/${inp.dataset.due}`, { due_on: dueOn });
      toast(`Nueva fecha para ${loan.title}: ${fmtDay(loan.due_on)}.`);
      route();
    } catch (err) { fail(err); }
  }));
}

// ══ LIBROS ═════════════════════════════════════════════════════════════
async function viewLibros(params) {
  loading();
  const showArchived = params.get("archivados") === "1";
  const [all] = await Promise.all([api("GET", `/api/books${showArchived ? "?archived=1" : ""}`), refreshSummary()]);
  // ?color=azul|rojo|verde|sin narrows the list to one age band.
  const want = params.get("color");
  const books = want ? all.filter((b) => (b.color || "sin") === want) : all;
  const colorHref = (c) => `#/libros?${new URLSearchParams({ ...(c ? { color: c } : {}), ...(showArchived ? { archivados: "1" } : {}) })}`;
  const count = (c) => all.filter((b) => (b.color || "sin") === c).length;
  main.innerHTML = `
    <div class="page-head"><div><h1>Libros</h1><p>${plural(books.filter((b) => !b.archived).length, "título", "títulos")} · ${plural(books.reduce((n, b) => n + b.total, 0), "ejemplar", "ejemplares")}</p></div>
      <button type="button" class="btn btn-go" id="add-toggle" aria-expanded="false" data-testid="add-book-toggle">${icon("plus")}Agregar libro</button></div>
    <form class="panel add-form" id="add-book" hidden novalidate data-testid="add-book-form">
      <h2>Libro nuevo</h2>
      <div class="grid">
        <label class="field"><span>Título</span><input class="input" name="title" required data-testid="book-title"></label>
        <label class="field"><span>Autor</span><input class="input" name="author" data-testid="book-author"></label>
        <label class="field"><span>Ejemplares</span><input class="input" name="copies" type="number" min="1" max="200" value="1" data-testid="book-copies"></label>
      </div>
      ${colorPicks(want && want !== "sin" ? want : "")}
      <label class="field"><span>Códigos (opcional)</span><input class="input" name="codes" placeholder="Si ya tienen etiqueta: B-0101, B-0102. Si no, los numero yo."><small>Separados por coma. Si los dejás vacíos, cada ejemplar recibe el siguiente número libre.</small></label>
      <div id="add-book-msg"></div>
      <div class="row"><button class="btn btn-go" type="submit" data-testid="book-save">${icon("check")}Guardar libro</button><button class="btn btn-quiet" type="button" id="add-cancel">Cancelar</button></div>
    </form>
    <nav class="chips color-filter" aria-label="Filtrar por color" data-testid="color-filter">
      <a class="chip" href="${colorHref("")}" ${!want ? 'aria-current="true"' : ""}>Todos</a>
      ${["azul", "rojo", "verde"].map((c) => `<a class="chip" href="${colorHref(c)}" ${want === c ? 'aria-current="true"' : ""} data-filter="${c}"><span class="dot" style="--c: var(--f-${FORRO_BY_COLOR[c]})"></span>${colorName(c)} <span class="muted">${COLORS[c].replace(" años", "")} · ${count(c)}</span></a>`).join("")}
      ${count("sin") ? `<a class="chip" href="${colorHref("sin")}" ${want === "sin" ? 'aria-current="true"' : ""} data-filter="sin"><span class="dot" style="--c: var(--f-gris)"></span>Sin color <span class="muted">· ${count("sin")}</span></a>` : ""}
    </nav>
    <div class="toolbar">
      <label class="input-icon">${icon("search")}<input class="input" id="filter" type="search" placeholder="Filtrar por título, autor o código" aria-label="Filtrar libros"></label>
      <a class="btn btn-quiet" href="#/libros${showArchived ? "" : "?archivados=1"}">${showArchived ? "Ocultar archivados" : "Ver archivados"}</a>
    </div>
    ${books.length ? `<div class="table-wrap"><table data-testid="books-table"><thead><tr><th>Título</th><th class="hide-sm">Autor</th><th>Disponibles</th></tr></thead>
      <tbody>${books.map((b) => `<tr data-hay="${esc((b.title + " " + b.author).toLowerCase())}">
        <td><div class="book-cell"><span class="forro swatch" ${forroAttrs(b)}></span><a href="${bookHref(b.id)}">${esc(b.title)}</a>${b.archived ? ' <span class="pill pill-off">Archivado</span>' : ""}</div></td>
        <td class="hide-sm">${esc(b.author)}</td>
        <td>${b.total ? `<span class="pill ${b.available ? "pill-ok" : "pill-out"}">${b.available} de ${b.total}</span>` : '<span class="muted">—</span>'}</td>
      </tr>`).join("")}</tbody></table></div>`
      : want ? `<div class="empty-state"><h3>No hay libros ${want === "sin" ? "sin color" : `de color ${want}`}</h3><p><a href="${colorHref("")}">Ver todos los libros</a></p></div>`
      : `<div class="empty-state"><h3>Todavía no hay libros</h3><p>Agregalos uno por uno con el botón amarillo, o traelos todos juntos de una planilla desde Ajustes.</p></div>`}`;

  const form = $("#add-book");
  const toggle = $("#add-toggle");
  const setOpen = (open) => { form.hidden = !open; toggle.setAttribute("aria-expanded", String(open)); if (open) form.title.focus(); };
  toggle.addEventListener("click", () => setOpen(form.hidden));
  $("#add-cancel").addEventListener("click", () => setOpen(false));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#add-book-msg");
    if (!form.title.value.trim()) { msg.innerHTML = `<div class="notice notice-error" role="alert">Falta el título.</div>`; form.title.setAttribute("aria-invalid", "true"); form.title.focus(); return; }
    try {
      const book = await api("POST", "/api/books", { title: form.title.value, author: form.author.value, copies: form.copies.value, codes: form.codes.value, color: form.color.value });
      toast(`Agregado: ${book.title} (${book.copies.map((c) => c.code).join(", ")})`);
      location.hash = bookHref(book.id);
    } catch (err) { msg.innerHTML = `<div class="notice notice-error" role="alert">${esc(err.message)}</div>`; }
  });
  wireFilter();
}

function wireFilter() {
  const f = $("#filter");
  f?.addEventListener("input", () => {
    const words = f.value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/).filter(Boolean);
    $$("tr[data-hay], [data-hay]").forEach((row) => {
      const hay = row.dataset.hay.normalize("NFD").replace(/[̀-ͯ]/g, "");
      row.hidden = !words.every((w) => hay.includes(w));
    });
  });
}

async function viewLibro(id) {
  loading();
  const [b] = await Promise.all([api("GET", `/api/books/${id}`), refreshSummary()]);
  main.innerHTML = `
    <a class="back" href="#/libros">← Libros</a>
    <div class="detail-head">
      <span class="forro" ${forroAttrs(b)}></span>
      <div><h1>${esc(b.title)}</h1><p class="muted" style="font-size:1.125rem">${esc(b.author)}</p>
        <div class="stat-line"><span data-testid="book-color"><span class="dot" style="--c: var(--f-${forro(b).name})"></span>${b.color ? `<strong>${colorName(b.color)}</strong> · ${COLORS[b.color]}` : "<strong>Sin color</strong> · tocá Editar para ponerle uno"}</span><span><strong>${b.available}</strong> de ${b.total} en la biblioteca</span><span>Prestado <strong>${plural(b.times_lent, "vez", "veces")}</strong></span>${b.archived ? '<span class="pill pill-off">Archivado</span>' : ""}</div></div>
      <div class="btn-col"><button type="button" class="btn btn-line" id="edit-toggle">Editar</button>
        <button type="button" class="btn btn-quiet ${b.archived ? "" : "btn-danger"}" id="archive">${icon("archive")}${b.archived ? "Reactivar" : "Archivar"}</button></div>
    </div>
    <form class="panel" id="edit-form" hidden>${colorPicks(b.color)}<div class="edit-inline">
      <label class="field"><span>Título</span><input class="input" name="title" value="${esc(b.title)}"></label>
      <label class="field"><span>Autor</span><input class="input" name="author" value="${esc(b.author)}"></label>
      <button class="btn btn-go" type="submit">Guardar</button></div></form>
    <section class="section" aria-labelledby="copies-h">
      <h2 id="copies-h">Ejemplares</h2>
      <div class="table-wrap"><table class="stack-sm" data-testid="copies-table"><thead><tr><th>Código</th><th>Estado</th><th>Quién lo tiene</th><th class="actions"></th></tr></thead><tbody>
      ${b.copies.map((c) => `<tr class="${c.loan?.overdue ? "is-late" : ""}">
        <td><strong>${esc(c.code)}</strong></td>
        <td>${statusPill(c, b.archived)}</td>
        <td>${c.loan ? `<a class="student-link" href="${studentHref(c.loan.student_id)}">${esc(c.loan.student)}</a> <span class="muted">${esc(c.loan.grade)} · ${c.loan.overdue ? `<span class="late-days">venció el ${fmtDay(c.loan.due_on)}</span>` : `vuelve ${fmtRel(c.loan.due_on)}`}</span>` : '<span class="muted">—</span>'}</td>
        <td class="actions">${c.loan ? `<button type="button" class="btn btn-line btn-sm" data-return="${esc(c.code)}">Devolver</button>`
          : `<button type="button" class="btn btn-quiet btn-sm" data-copy="${esc(c.code)}" data-archived="${c.archived ? 0 : 1}">${c.archived ? "Reactivar" : "Dar de baja"}</button>`}</td>
      </tr>`).join("")}</tbody></table></div>
      ${b.archived ? "" : `<form id="add-copy" class="toolbar" style="margin-top:14px"><label class="field" style="flex:0 1 260px"><span>Agregar ejemplar</span><input class="input" name="code" placeholder="Código (opcional)"></label><button class="btn btn-line" type="submit" style="align-self:end">${icon("plus")}Agregar</button></form>`}
    </section>
    <section class="section" aria-labelledby="hist-h"><h2 id="hist-h">Historial <small>${plural(b.history.length, "préstamo", "préstamos")}</small></h2>${historyTable(b.history, "student", `Todavía nadie se lo llevó. Se presta desde el <a href="#/mostrador">Mostrador</a>.`)}</section>`;

  $("#edit-toggle").addEventListener("click", () => { $("#edit-form").hidden = !$("#edit-form").hidden; });
  $("#edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("PATCH", `/api/books/${id}`, { title: e.target.title.value, author: e.target.author.value, color: e.target.color.value }); toast("Guardado."); route(); } catch (err) { fail(err); }
  });
  $("#archive").addEventListener("click", async () => {
    try {
      await api("PATCH", `/api/books/${id}`, { archived: !b.archived });
      toast(b.archived ? "Libro reactivado." : "Libro archivado. Su historial queda guardado.", b.archived ? {} : { action: async () => { await api("PATCH", `/api/books/${id}`, { archived: false }); route(); } });
      route();
    } catch (err) { fail(err); }
  });
  $$("[data-copy]").forEach((btn) => btn.addEventListener("click", async () => {
    try { await api("PATCH", `/api/copies/${encodeURIComponent(btn.dataset.copy)}`, { archived: btn.dataset.archived === "1" }); route(); } catch (err) { fail(err); }
  }));
  $("#add-copy")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("POST", `/api/books/${id}/copies`, { code: e.target.code.value }); toast("Ejemplar agregado."); route(); } catch (err) { fail(err); }
  });
  wireLoanActions();
}

function historyTable(rows, who, empty) {
  if (!rows.length) return `<p class="muted" data-testid="history-empty">${empty}</p>`;
  return `<div class="table-wrap"><table class="stack-sm"><thead><tr><th>${who === "student" ? "Alumno" : "Libro"}</th><th>Prestado</th><th>Vuelve / volvió</th><th class="hide-sm">Estado</th></tr></thead><tbody>
    ${rows.map((l) => `<tr>
      <td>${who === "student" ? `<a class="student-link" href="${studentHref(l.student_id)}">${esc(l.student)}</a> <span class="muted">${esc(l.grade)}</span>`
        : `<div class="book-cell"><span class="forro swatch" ${forroAttrs(l)} style="width:20px;height:27px;${forro(l).style}"></span><a href="${bookHref(l.book_id)}">${esc(l.title)}</a> <span class="code">${esc(l.code)}</span></div>`}</td>
      <td data-label="Prestado">${fmtDay(l.lent_on)}</td>
      <td data-label="${l.returned_on ? "Volvió" : "Vuelve"}">${l.returned_on ? fmtDay(l.returned_on) : fmtDay(l.due_on)}</td>
      <td class="hide-sm">${l.open ? (l.overdue ? '<span class="pill pill-late">Atrasado</span>' : '<span class="pill pill-out">Prestado</span>') : '<span class="pill pill-ok">Devuelto</span>'}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

// ══ ALUMNOS ════════════════════════════════════════════════════════════
async function viewAlumnos(params) {
  loading();
  const grade = params.get("clase") || "";
  const showArchived = params.get("archivados") === "1";
  const qs = new URLSearchParams();
  if (grade) qs.set("grade", grade);
  if (showArchived) qs.set("archived", "1");
  const [students] = await Promise.all([api("GET", `/api/students?${qs}`), refreshSummary()]);
  const groups = new Map();
  for (const s of students) { const k = s.grade || "Sin clase"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  const link = (g) => `#/alumnos${g ? `?clase=${encodeURIComponent(g)}` : ""}`;
  main.innerHTML = `
    <div class="page-head"><div><h1>Alumnos</h1><p>${plural(students.length, "alumno", "alumnos")}${grade ? ` en ${esc(grade)}` : ""}</p></div>
      <button type="button" class="btn btn-go" id="add-toggle" aria-expanded="false" data-testid="add-student-toggle">${icon("plus")}Agregar alumno</button></div>
    <form class="panel add-form" id="add-student" hidden novalidate>
      <h2>Alumno nuevo</h2>
      <div class="grid" style="grid-template-columns:2fr 1fr"><label class="field"><span>Nombre y apellido</span><input class="input" name="name" data-testid="student-name"></label>
        <label class="field"><span>Clase</span><input class="input" name="grade" placeholder="4°B" list="grades" data-testid="student-grade"></label></div>
      <datalist id="grades">${summary.grades.map((g) => `<option value="${esc(g)}">`).join("")}</datalist>
      <div id="add-student-msg"></div>
      <div class="row"><button class="btn btn-go" type="submit" data-testid="student-save">${icon("check")}Guardar</button><button class="btn btn-quiet" type="button" id="add-cancel">Cancelar</button></div>
    </form>
    <div class="toolbar">
      <label class="input-icon">${icon("search")}<input class="input" id="filter" type="search" placeholder="Filtrar por nombre" aria-label="Filtrar alumnos"></label>
      <div class="chips" aria-label="Clases"><a class="chip" href="${link("")}" aria-pressed="${!grade}">Todas</a>${summary.grades.map((g) => `<a class="chip" href="${link(g)}" aria-pressed="${g === grade}">${esc(g)}</a>`).join("")}</div>
      <a class="btn btn-quiet" href="#/alumnos?${showArchived ? "" : "archivados=1"}">${showArchived ? "Ocultar archivados" : "Ver archivados"}</a>
    </div>
    ${students.length ? [...groups].map(([g, list]) => `<section class="grade-group" data-hay-group>
      <h3>${esc(g)} <small>${plural(list.length, "alumno", "alumnos")} · ${plural(list.reduce((n, s) => n + s.open_loans, 0), "libro afuera", "libros afuera")}</small></h3>
      <div class="table-wrap"><table><tbody>${list.map((s) => `<tr data-hay="${esc(s.name.toLowerCase())}">
        <td><div class="book-cell"><span class="avatar" style="${studentColor(s.id)};width:34px;height:34px;font-size:.875rem">${esc(initials(s.name))}</span><a class="student-link" href="${studentHref(s.id)}">${esc(s.name)}</a>${s.archived ? ' <span class="pill pill-off">Archivado</span>' : ""}</div></td>
        <td>${s.open_loans ? `<span class="pill ${s.overdue ? "pill-late" : "pill-out"}">${plural(s.open_loans, "libro", "libros")}${s.overdue ? ", con atraso" : ""}</span>` : '<span class="muted">Sin libros</span>'}</td>
        <td class="actions hide-sm"><a class="btn btn-quiet btn-sm" href="#/mostrador?alumno=${s.id}">Prestarle</a></td>
      </tr>`).join("")}</tbody></table></div></section>`).join("")
      : `<div class="empty-state"><h3>${grade ? `No hay alumnos en ${esc(grade)}` : "Todavía no hay alumnos"}</h3><p>Agregalos uno por uno, o traé la lista de cada clase desde una planilla en Ajustes.</p></div>`}`;

  const form = $("#add-student");
  const toggle = $("#add-toggle");
  const setOpen = (open) => { form.hidden = !open; toggle.setAttribute("aria-expanded", String(open)); if (open) form.name.focus(); };
  toggle.addEventListener("click", () => setOpen(form.hidden));
  $("#add-cancel").addEventListener("click", () => setOpen(false));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#add-student-msg");
    if (!form.name.value.trim()) { msg.innerHTML = `<div class="notice notice-error" role="alert">Falta el nombre.</div>`; form.name.focus(); return; }
    try {
      const s = await api("POST", "/api/students", { name: form.name.value, grade: form.grade.value });
      toast(`Agregado: ${s.name}${s.grade ? ` (${s.grade})` : ""}`);
      form.name.value = "";
      msg.innerHTML = "";
      viewAlumnosKeepForm(params, s.grade);
    } catch (err) { msg.innerHTML = `<div class="notice notice-error" role="alert">${esc(err.message)}</div>`; }
  });
  wireFilter();
}

// After adding a student keep the form open with the same class, so a whole class can be typed in a row.
async function viewAlumnosKeepForm(params, grade) {
  await viewAlumnos(params);
  $("#add-toggle").click();
  $("#add-student").grade.value = grade || "";
}

async function viewAlumno(id) {
  loading();
  const [s] = await Promise.all([api("GET", `/api/students/${id}`), refreshSummary()]);
  main.innerHTML = `
    <a class="back" href="#/alumnos">← Alumnos</a>
    <div class="detail-head">
      <span class="avatar" style="${studentColor(s.id)}">${esc(initials(s.name))}</span>
      <div><h1>${esc(s.name)}</h1>
        <div class="stat-line"><span>${esc(s.grade || "Sin clase")}</span><span>Se llevó <strong>${plural(s.times_borrowed, "libro", "libros")}</strong> en total</span>${s.archived ? '<span class="pill pill-off">Archivado</span>' : ""}</div></div>
      <div class="btn-col">${s.archived ? "" : `<a class="btn btn-go" href="#/mostrador?alumno=${s.id}">${icon("book-marked")}Prestarle un libro</a>`}
        <button type="button" class="btn btn-line" id="edit-toggle">Editar</button>
        <button type="button" class="btn btn-quiet ${s.archived ? "" : "btn-danger"}" id="archive">${icon("archive")}${s.archived ? "Reactivar" : "Archivar"}</button></div>
    </div>
    <form class="panel" id="edit-form" hidden><div class="edit-inline">
      <label class="field"><span>Nombre</span><input class="input" name="name" value="${esc(s.name)}"></label>
      <label class="field"><span>Clase</span><input class="input" name="grade" value="${esc(s.grade)}"></label>
      <button class="btn btn-go" type="submit">Guardar</button></div></form>
    <section class="section" aria-labelledby="now-h"><h2 id="now-h">Libros en su poder</h2>
      ${s.loans.length ? `<div class="table-wrap"><table class="stack-sm" data-testid="student-loans"><thead><tr><th>Libro</th><th>Prestado</th><th>Vuelve el</th><th class="actions"></th></tr></thead><tbody>
        ${s.loans.map((l) => `<tr class="${l.overdue ? "is-late" : ""}">
          <td><div class="book-cell"><span class="forro swatch" ${forroAttrs(l)}></span><span><a href="${bookHref(l.book_id)}">${esc(l.title)}</a><br><span class="code">${esc(l.code)}</span>${l.overdue ? ` <span class="late-days">· ${plural(l.days_late, "día", "días")} de atraso</span>` : ""}</span></div></td>
          <td data-label="Prestado">${fmtDay(l.lent_on)}</td>
          <td data-label="Vuelve"><input class="line-input hand due-edit" value="${fmtDM(l.due_on)}" inputmode="numeric" data-due="${l.id}" aria-label="Fecha de vuelta de ${esc(l.title)}, día y mes"></td>
          <td class="actions"><button type="button" class="btn btn-quiet btn-sm" data-renew="${l.id}">${icon("rotate-cw")}Renovar</button>
            <button type="button" class="btn btn-line btn-sm" data-return="${esc(l.code)}">Devolver</button></td>
        </tr>`).join("")}</tbody></table></div>` : `<p class="muted">No tiene libros prestados.</p>`}
    </section>
    <section class="section" aria-labelledby="hist-h"><h2 id="hist-h">Lo que leyó <small>${plural(s.history.length, "préstamo", "préstamos")}</small></h2>${historyTable(s.history, "book", s.archived ? "Nunca se llevó un libro." : "Todavía no se llevó ningún libro. Prestale uno con el botón amarillo de arriba.")}</section>`;

  $("#edit-toggle").addEventListener("click", () => { $("#edit-form").hidden = !$("#edit-form").hidden; });
  $("#edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("PATCH", `/api/students/${id}`, { name: e.target.name.value, grade: e.target.grade.value }); toast("Guardado."); route(); } catch (err) { fail(err); }
  });
  $("#archive").addEventListener("click", async () => {
    try {
      await api("PATCH", `/api/students/${id}`, { archived: !s.archived });
      toast(s.archived ? "Alumno reactivado." : "Alumno archivado. Su historial queda guardado.", s.archived ? {} : { action: async () => { await api("PATCH", `/api/students/${id}`, { archived: false }); route(); } });
      route();
    } catch (err) { fail(err); }
  });
  wireLoanActions();
}

// ══ AJUSTES ════════════════════════════════════════════════════════════
async function viewAjustes() {
  await refreshSummary();
  const st = summary.settings;
  main.innerHTML = `
    <div class="page-head"><div><h1>Ajustes</h1><p>Reglas de préstamo, cargar planillas y copias de seguridad.</p></div></div>
    <div class="settings">
      <form class="panel" id="settings-form" novalidate>
        <h2>Reglas</h2>
        <label class="field"><span>Nombre de la biblioteca</span><input class="input" name="library_name" value="${esc(st.library_name)}" data-testid="set-name"></label>
        <div class="grid-2">
          <label class="field"><span>Días de préstamo</span><input class="input" name="loan_days" type="number" min="1" max="365" value="${st.loan_days}"><small>La fecha que se propone al prestar.</small></label>
          <label class="field"><span>Libros por alumno</span><input class="input" name="max_loans" type="number" min="1" max="365" value="${st.max_loans}"><small>Si se pasa, te aviso pero podés prestar igual.</small></label>
        </div>
        <div id="settings-msg"></div>
        <div><button class="btn btn-go" type="submit">${icon("check")}Guardar</button></div>
      </form>

      <div class="panel">
        <h2>Copia de seguridad</h2>
        <p>Todo se guarda <strong>solo en este iPad</strong>. Guardá una copia una vez por semana: queda en la app Archivos y desde ahí la podés mandar por mail o a Drive.</p>
        <p data-testid="last-backup">${summary.last_backup ? `Última copia: <strong>${fmtRel(summary.last_backup) === fmtDay(summary.last_backup) ? "el " + fmtDay(summary.last_backup) : fmtRel(summary.last_backup)}</strong>.` : "<strong>Todavía no guardaste ninguna copia.</strong>"}</p>
        <div class="btn-col">
          <button type="button" class="btn btn-go" data-download="backup" data-testid="backup">${icon("download")}Guardar copia de seguridad</button>
        </div>
        <form id="restore" class="file-drop">
          <span class="field-label">Recuperar una copia</span>
          <input type="file" name="file" accept=".json,application/json" data-testid="restore-file">
          <small class="muted">Reemplaza todo lo que hay ahora por lo que tenía la copia.</small>
          <div class="restore-msg" aria-live="polite"></div>
          <div><button class="btn btn-line" type="submit">${icon("upload")}Recuperar</button></div>
        </form>
      </div>

      <div class="panel">
        <h2>Planillas para Excel</h2>
        <p>Listas en Excel (.xlsx) para abrir en Excel o Numbers, imprimir o mandar a la dirección.</p>
        <div class="btn-col">
          <button type="button" class="btn btn-line" data-download="loans">${icon("download")}Préstamos</button>
          <button type="button" class="btn btn-line" data-download="books">${icon("download")}Libros</button>
          <button type="button" class="btn btn-line" data-download="students">${icon("download")}Alumnos</button>
        </div>
      </div>

      <form class="panel" id="import-students">
        <h2>Cargar alumnos desde Excel</h2>
        <p>Dos columnas: nombre y clase. Lo más fácil: seleccioná las filas en Excel o Numbers, copiá y pegá acá.</p>
        <pre class="sample">Nombre;Clase
Martina López;4°B
Joaquín Pereira;4°B</pre>
        <label class="field"><span>Pegá las filas copiadas de Excel o Numbers</span><textarea class="input paste" name="paste" rows="4" placeholder="Martina López	4°B" data-testid="import-students-paste"></textarea></label>
        <label class="file-drop"><span class="field-label">…o elegí la planilla (Excel .xlsx o CSV)</span><input type="file" name="file" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-testid="import-students-file"></label>
        <div class="import-msg" aria-live="polite"></div>
        <div><button class="btn btn-go" type="submit">${icon("upload")}Cargar alumnos</button></div>
      </form>

      <form class="panel" id="import-books">
        <h2>Cargar libros desde Excel</h2>
        <p>Columnas: título, autor, ejemplares, color (azul, rojo o verde) y, si ya tienen, código. Los repetidos se saltean.</p>
        <pre class="sample">Titulo;Autor;Ejemplares;Color;Codigo
Cuentos de la selva;Horacio Quiroga;3;Rojo;
Matilda;Roald Dahl;1;Rojo;B-0040</pre>
        <label class="field"><span>Pegá las filas copiadas de Excel o Numbers</span><textarea class="input paste" name="paste" rows="4" placeholder="Matilda	Roald Dahl	1" data-testid="import-books-paste"></textarea></label>
        <label class="file-drop"><span class="field-label">…o elegí la planilla (Excel .xlsx o CSV)</span><input type="file" name="file" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-testid="import-books-file"></label>
        <div class="import-msg" aria-live="polite"></div>
        <div><button class="btn btn-go" type="submit">${icon("upload")}Cargar libros</button></div>
      </form>

      <form class="panel" id="import-loans">
        <h2>Cargar préstamos desde Excel</h2>
        <p>Para pasar el registro que ya tenés: un préstamo por fila. Sirven los que están afuera y también los ya devueltos (quedan en el historial).</p>
        <pre class="sample">Alumno;Clase;Libro;Prestado;Vence;Devuelto
Martina López;4°B;Matilda;01/10/2026;15/10/2026;
Joaquín Pereira;4°B;B-0012;20/09/2026;04/10/2026;02/10/2026</pre>
        <p class="muted" style="font-size:.9375rem">En <strong>Libro</strong> va el título o el código. <strong>Clase</strong>, <strong>Vence</strong> y <strong>Devuelto</strong> son opcionales; si falta <strong>Prestado</strong> uso hoy. Si un alumno o un libro todavía no está en la lista, lo agrego y te aviso cuáles.</p>
        <label class="field"><span>Pegá las filas copiadas de Excel o Numbers (con la fila de títulos)</span><textarea class="input paste" name="paste" rows="4" placeholder="Alumno	Clase	Libro	Prestado" data-testid="import-loans-paste"></textarea></label>
        <label class="file-drop"><span class="field-label">…o elegí la planilla (Excel .xlsx o CSV)</span><input type="file" name="file" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-testid="import-loans-file"></label>
        <div class="import-msg" aria-live="polite"></div>
        <div><button class="btn btn-go" type="submit">${icon("upload")}Cargar préstamos</button></div>
      </form>

      <div class="panel">
        <h2>Datos de ejemplo</h2>
        ${summary.has_demo
          ? `<p>Hay datos de ejemplo cargados. Al borrarlos se van los libros y alumnos inventados, con todos sus préstamos (también los que hiciste con ellos). Tus libros y alumnos quedan.</p><div><button type="button" class="btn btn-line btn-danger" data-action="clear-demo">Borrar datos de ejemplo</button></div>`
          : `<p>Para probar la app sin miedo: carga libros, alumnos y préstamos inventados que después podés borrar.</p><div><button type="button" class="btn btn-line" data-action="load-demo">${icon("sparkles")}Cargar datos de ejemplo</button></div>`}
      </div>
    </div>`;

  $("#settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api("PATCH", "/api/settings", { library_name: f.library_name.value, loan_days: f.loan_days.value, max_loans: f.max_loans.value });
      $("#settings-msg").innerHTML = "";
      toast("Guardado.");
      refreshSummary();
    } catch (err) { $("#settings-msg").innerHTML = `<div class="notice notice-error" role="alert">${esc(err.message)}</div>`; }
  });
  for (const [formId, kind, one, many] of [["#import-students", "students", "alumno", "alumnos"], ["#import-books", "books", "libro", "libros"]]) {
    $(formId).addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = $(".import-msg", e.target);
      const file = e.target.file.files[0];
      const pasted = e.target.paste.value;
      if (!file && !pasted.trim()) { msg.innerHTML = `<div class="notice notice-error" role="alert">Pegá las filas o elegí un archivo primero.</div>`; return; }
      try {
        const body = !file ? { text: pasted }
          : /\.xlsx$/i.test(file.name) ? { rows: await readXlsx(await file.arrayBuffer()) }
          : { text: await file.text() };
        const res = await api("POST", `/api/import/${kind}`, body);
        msg.innerHTML = `<div class="notice ${res.errors.length ? "notice-warn" : "notice-ok"}" data-testid="import-result"><p>Cargué ${plural(res.added, one, many)}.${res.skipped ? ` ${res.skipped} ya estaban.` : ""}</p>
          ${res.errors.length ? `<ul class="lines">${res.errors.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`;
        e.target.reset();
        refreshSummary();
      } catch (err) { msg.innerHTML = `<div class="notice notice-error" role="alert">${esc(err.message)}</div>`; }
    });
  }
  $("#import-loans").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $(".import-msg", e.target);
    const file = e.target.file.files[0];
    const pasted = e.target.paste.value;
    if (!file && !pasted.trim()) { msg.innerHTML = `<div class="notice notice-error" role="alert">Pegá las filas o elegí un archivo primero.</div>`; return; }
    try {
      const body = !file ? { text: pasted }
        : /\.xlsx$/i.test(file.name) ? { rows: await readXlsx(await file.arrayBuffer()) }
        : { text: await file.text() };
      const res = await api("POST", "/api/import/loans", body);
      const parts = [`Cargué ${plural(res.added, "préstamo", "préstamos")}${res.returned ? ` (${res.returned} ya devuelto${res.returned === 1 ? "" : "s"}, quedan en el historial)` : ""}.`];
      if (res.skipped) parts.push(`${res.skipped} ya estaba${res.skipped === 1 ? "" : "n"}.`);
      msg.innerHTML = `<div class="notice ${res.errors.length ? "notice-warn" : "notice-ok"}" data-testid="import-result"><p>${parts.join(" ")}</p>
        ${res.new_students.length ? `<p>Alumnos nuevos: ${esc(res.new_students.join(", "))}.</p>` : ""}
        ${res.new_books.length ? `<p>Libros nuevos: ${esc(res.new_books.join(", "))}.</p>` : ""}
        ${res.errors.length ? `<ul class="lines">${res.errors.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`;
      e.target.reset();
      refreshSummary();
    } catch (err) { msg.innerHTML = `<div class="notice notice-error" role="alert">${esc(err.message)}</div>`; }
  });
  $$("[data-download]").forEach((b) => b.addEventListener("click", async () => {
    try {
      const name = download(b.dataset.download);
      await flushed();
      toast(`Listo: ${name} quedó en Descargas (app Archivos).`);
      if (b.dataset.download === "backup") viewAjustes();
    } catch (err) { fail(err); }
  }));
  $("#restore").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $(".restore-msg", e.target);
    const file = e.target.file.files[0];
    if (!file) { msg.innerHTML = `<div class="notice notice-error" role="alert">Elegí el archivo de la copia primero.</div>`; return; }
    try {
      const res = await api("POST", "/api/restore", { text: await file.text() });
      toast(`Copia recuperada: ${plural(res.books, "libro", "libros")}, ${plural(res.students, "alumno", "alumnos")}.`);
      location.hash = "#/mostrador";
    } catch (err) { msg.innerHTML = `<div class="notice notice-error" role="alert">${esc(err.message)}</div>`; }
  });
  wireFirstRun();
}

// ══ AYUDA ══════════════════════════════════════════════════════════════
// Plain cards she can come back to when she forgets a step. No data is touched here.
async function viewAyuda() {
  await refreshSummary();
  const days = summary.settings.loan_days;
  const card = (id, ic, title, steps, link) => `<section class="panel help-card" aria-labelledby="h-${id}" data-testid="help-${id}">
    <h2 id="h-${id}"><span class="help-icon">${icon(ic)}</span>${title}</h2>
    <ol class="help-steps">${steps.map((s) => `<li>${s}</li>`).join("")}</ol>
    ${link ? `<a class="btn btn-line btn-sm" href="${link[0]}">${link[1]}</a>` : ""}
  </section>`;
  main.innerHTML = `
    <div class="page-head"><div><h1>Cómo se usa</h1><p>Lo de todos los días, paso por paso. Si algo no sale, volvé acá con el botón <strong>?</strong> de arriba.</p></div></div>
    <div class="help-grid">
      ${card("prestar", "book-marked", "Prestar un libro", [
        "En el <strong>Mostrador</strong>, tocá <strong>Prestar</strong>.",
        "En <strong>Nombre</strong>, escribí el nombre o la clase del alumno y tocalo en la lista.",
        "En <strong>Libro</strong>, escribí el título o el código, o escanealo con el lector.",
        `<strong>Vuelve</strong> ya trae la fecha (${plural(days, "día", "días")}). Para cambiarla, tocá 1, 2 o 3 semanas, o escribila como 17/10.`,
        "Tocá el botón amarillo <strong>Prestar</strong>.",
      ], ["#/mostrador", "Ir al Mostrador"])}
      ${card("devolver", "undo-2", "Recibir un libro que vuelve", [
        "En el <strong>Mostrador</strong>, tocá <strong>Devolver</strong>.",
        "Escribí el código, el título o el nombre del alumno, y tocá el libro en la lista. Con el lector: escaneá y listo.",
        "¿Te equivocaste de libro? Tocá <strong>Deshacer</strong> en el aviso que aparece abajo.",
      ], ["#/mostrador", "Ir al Mostrador"])}
      ${card("atrasados", "calendar-clock", "Reclamar los atrasados", [
        "La pestaña <strong>Atrasados</strong> tiene los libros que ya tendrían que haber vuelto, los más viejos primero. El número rojo de arriba dice cuántos son.",
        "<strong>Imprimir lista</strong> te da la hoja para llevar a las clases.",
        `<strong>Renovar</strong> le da ${plural(days, "día", "días")} más, contando desde hoy.`,
      ], ["#/atrasados", "Ver atrasados"])}
      ${card("preguntar", "search", "Preguntar quién tiene qué", [
        "En la caja <strong>Preguntá</strong> del Mostrador, escribí un libro, un alumno, una clase o un código: «Matilda», «Martina», «4°B».",
        "O tocá una pregunta rápida: <strong>Atrasados</strong>, <strong>Prestados hoy</strong>, <strong>Más leídos</strong>.",
      ])}
      ${card("cargar", "plus", "Agregar alumnos y libros", [
        "De a uno: en <strong>Libros</strong> o <strong>Alumnos</strong>, con el botón amarillo de arriba. A cada libro elegile su color: <strong>azul</strong> (0 a 7 años), <strong>rojo</strong> (7 a 10) o <strong>verde</strong> (10 a 12).",
        "Todos juntos: en <strong>Ajustes</strong>, elegí la planilla de Excel desde Archivos (o pegá las filas) y tocá <strong>Cargar alumnos</strong> o <strong>Cargar libros</strong>. Si la planilla de libros tiene una columna <strong>Color</strong>, se usa.",
        "Los libros sin color se ven grises. En <strong>Libros</strong>, el filtro <strong>Sin color</strong> te muestra cuáles faltan.",
        "Nada se borra: un alumno que se fue se <strong>archiva</strong> desde su página. Si se rompe un ejemplar, en la página del libro tocá <strong>Dar de baja</strong> en su fila. Antes tienen que devolver lo que tengan prestado, y el historial queda.",
      ], ["#/ajustes", "Ir a Ajustes"])}
      ${card("copia", "download", "Guardar una copia de seguridad", [
        "Todo está guardado solo en este iPad. Una vez por semana, tocá <strong>Ajustes → Guardar copia de seguridad</strong>. El archivo queda en la app Archivos: mandátelo por mail o a Drive, así no se pierde si le pasa algo al iPad.",
        "La app te avisa en el Mostrador cuando pasó una semana sin copia (mientras haya datos de ejemplo no avisa).",
        "Si un día cambiás de iPad: en el nuevo, <strong>Ajustes → Recuperar una copia</strong>.",
      ], ["#/ajustes", "Ir a Ajustes"])}
      ${card("probar", "sparkles", "Probar sin miedo", [
        "En <strong>Ajustes</strong> podés cargar <strong>datos de ejemplo</strong>: libros, alumnos y préstamos inventados para practicar.",
        "Cuando termines, <strong>Borrar datos de ejemplo</strong> quita los libros y alumnos de ejemplo, con todos sus préstamos. Tus libros y alumnos quedan. Borralos antes de empezar a prestar en serio.",
      ])}
    </div>`;
}

// demo strip + ajustes share this
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action=clear-demo]");
  if (!b) return;
  try {
    await api("DELETE", "/api/demo");
    toast("Borré los datos de ejemplo. Tus libros y alumnos siguen ahí.");
    route();
  } catch (err) { fail(err); }
});

// ── router ────────────────────────────────────────────────────────────
async function route() {
  const [path, query = ""] = (location.hash.slice(1) || "/mostrador").split("?");
  const params = new URLSearchParams(query);
  const parts = path.split("/").filter(Boolean);
  const section = parts[0] || "mostrador";
  $$(".tabs a, .help-link").forEach((a) => {
    if (a.dataset.tab === section) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  try {
    if (section === "atrasados") await viewAtrasados();
    else if (section === "libros" && parts[1]) await viewLibro(parts[1]);
    else if (section === "libros") await viewLibros(params);
    else if (section === "alumnos" && parts[1]) await viewAlumno(parts[1]);
    else if (section === "alumnos") await viewAlumnos(params);
    else if (section === "ajustes") await viewAjustes();
    else if (section === "ayuda") await viewAyuda();
    else await viewMostrador(params);
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><h3>No pude abrir esta página</h3><p>${esc(err.message)}</p><a class="btn btn-line" href="#/mostrador">Volver al mostrador</a></div>`;
  }
}

let lastSection = null;
window.addEventListener("hashchange", () => {
  const section = (location.hash.slice(2) || "mostrador").split(/[/?]/)[0];
  if (section !== lastSection) window.scrollTo(0, 0);
  lastSection = section;
  route();
});

start({ saveError: () => toast("No pude guardar en este iPad. Guardá una copia de seguridad desde Ajustes.", { error: true, ms: 15000 }) })
  .then(route)
  .catch(() => {
    main.innerHTML = `<div class="empty-state"><h3>No pude abrir la biblioteca</h3><p>Safari no deja guardar datos. Revisá que no estés en navegación privada.</p></div>`;
  });

// Works without internet once opened: the service worker keeps a copy of the app.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
