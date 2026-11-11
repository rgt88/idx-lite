/* IDX Lite Terminal: baris perintah di atas core.js. */
"use strict";

/* ---------- jalankan ---------- */
let panelNo = 0;
function addPanel(line) {
  const n = ++panelNo;
  const sec = document.createElement("section");
  sec.className = "panel"; sec.id = "r" + n; sec.tabIndex = -1;
  sec.innerHTML = `<header><span class="no">${String(n).padStart(2, "0")}</span><code>idx ${esc(line)}</code><span class="meta"></span><button class="x" aria-label="Tutup panel">×</button></header><div class="body"><p class="muted">Memuat…</p></div>`;
  $("#results").prepend(sec);
  return sec;
}
async function run(line, { record = true } = {}) {
  line = line.trim();
  if (!line) return;
  if (record) pushHist(line);
  const sec = addPanel(line);
  const body = $(".body", sec);
  const t0 = performance.now();
  try {
    const [cmd, rest] = resolve(tokenize(line));
    need(cmd, `Perintah "${tokenize(line)[0]}" tidak dikenal. Ketik help untuk daftar perintah.`);
    const args = parseArgs(rest);
    const out = await cmd.fn(args, body, sec);
    if (typeof out === "string") body.innerHTML = out;
    const sym = String(args.pos[0] || "").toUpperCase().replace(/\.JK$/, "");
    if (FLAG_CMDS().has(cmd) && HSC_SET.has(sym)) body.insertAdjacentHTML("afterbegin", hscFlag(sym));
  } catch (e) {
    body.innerHTML = `<p class="err">${esc(e instanceof UserError ? e.message : "Gagal: " + e.message)}</p>`;
    if (!(e instanceof UserError)) console.error(e);
  }
  $(".meta", sec).textContent = `${Math.round(performance.now() - t0)} ms`;
  history.replaceState(null, "", `?cmd=${encodeURIComponent(line)}#${sec.id}`);
  sec.scrollIntoView({ block: "nearest" });
}

/* ---------- baris perintah & saran ---------- */
const input = $("#cmd"), list = $("#sugg");
let hIdx = -1, sel = -1, items = [];
const SYM_CMDS = ["quote", "brief", "technical", "fundamental", "ownership", "broker", "foreign", "bandar"];
function suggestions(text) {
  const t = text.trimStart(), lower = t.toLowerCase();
  if (!t) return [];
  const toks = t.split(/\s+/);
  const out = [];
  if (toks.length === 1) {
    for (const [name, c] of Object.entries(COMMANDS)) if (!c.alias && name.startsWith(lower) && name !== lower) out.push([name + (SYM_CMDS.includes(name) ? " " : ""), c.desc]);
    const up = t.toUpperCase();
    for (const s of SYMBOLS) if (s.startsWith(up)) out.push([s, (HSC_SET.has(s) ? "⚑ HSC · " : "") + (NAMES[s] || "harga & grafik")]);
  } else if (toks.length === 2 && SYM_CMDS.includes(toks[0].toLowerCase())) {
    const up = toks[1].toUpperCase();
    if (toks[0].toLowerCase() === "bandar") for (const sub of ["screen", "broker"]) if (sub.startsWith(toks[1].toLowerCase())) out.push([`bandar ${sub} `, COMMANDS[`bandar ${sub}`].desc]);
    for (const s of SYMBOLS) if (s.startsWith(up)) out.push([`${toks[0].toLowerCase()} ${s}`, NAMES[s] || ""]);
  } else if (/^bandar screen/i.test(t) && /--preset\s+\S*$/i.test(t)) {
    const part = t.match(/--preset\s+(\S*)$/i)[1].toLowerCase();
    for (const p of Object.keys(PRESETS)) if (p.startsWith(part)) out.push([t.replace(/--preset\s+\S*$/i, `--preset ${p}`), "preset"]);
  }
  return out.slice(0, 12);
}
function renderSugg() {
  items = suggestions(input.value);
  sel = -1;
  list.hidden = !items.length;
  input.setAttribute("aria-expanded", String(!list.hidden));
  list.innerHTML = items.map(([c, d], i) => `<li role="option" id="s${i}" data-i="${i}"><code>${esc(c)}</code><span>${esc(d)}</span></li>`).join("");
}
function highlight(i) {
  sel = (i + items.length) % items.length;
  list.querySelectorAll("li").forEach((li, j) => li.setAttribute("aria-selected", String(j === sel)));
  input.setAttribute("aria-activedescendant", "s" + sel);
}
const closeSugg = () => { list.hidden = true; items = []; sel = -1; input.setAttribute("aria-expanded", "false"); };

$("#form").addEventListener("submit", (e) => {
  e.preventDefault();
  const line = sel >= 0 ? items[sel][0] : input.value;
  input.value = "";
  hIdx = -1;
  closeSugg();
  run(line);
});
input.addEventListener("input", renderSugg);
input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (items.length) return highlight(sel + (e.key === "ArrowDown" ? 1 : -1));
    const h = loadHist();
    if (!h.length) return;
    hIdx = e.key === "ArrowUp" ? Math.min(h.length - 1, hIdx + 1) : Math.max(-1, hIdx - 1);
    input.value = hIdx < 0 ? "" : h[h.length - 1 - hIdx];
  } else if (e.key === "Tab" && items.length) {
    e.preventDefault();
    input.value = items[Math.max(sel, 0)][0];
    renderSugg();
  } else if (e.key === "Escape") {
    if (!list.hidden) closeSugg();
    else if (input.value) input.value = "";
    else input.blur();
  }
});
list.addEventListener("mousedown", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  e.preventDefault();
  input.value = items[li.dataset.i][0];
  if (input.value.endsWith(" ")) { input.focus(); renderSugg(); } else { $("#form").requestSubmit(); }
});
input.addEventListener("blur", () => setTimeout(closeSugg, 100));

document.addEventListener("click", (e) => {
  const x = e.target.closest(".panel .x");
  if (x) { x.closest(".panel").remove(); return; }
  const c = e.target.closest("[data-cmd]");
  if (c) { e.preventDefault(); run(c.dataset.cmd); window.scrollTo({ top: 0, behavior: "smooth" }); }
});
document.addEventListener("keydown", (e) => {
  if (e.target === input || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const panels = [...document.querySelectorAll("#results .panel")];
  const cur = panels.indexOf(document.activeElement.closest?.(".panel"));
  if (e.key === "/") { e.preventDefault(); input.focus(); }
  else if (e.key === "?") { run("help"); }
  else if ((e.key === "j" || e.key === "k") && panels.length) {
    const next = e.key === "j" ? Math.min(panels.length - 1, cur + 1) : Math.max(0, cur - 1);
    panels[next].focus();
    panels[next].scrollIntoView({ block: "start", behavior: "smooth" });
  } else if (/^[1-9]$/.test(e.key)) {
    const p = document.getElementById("r" + e.key);
    if (p) { p.focus(); p.scrollIntoView({ block: "start", behavior: "smooth" }); }
  }
});

/* ---------- mulai ---------- */
(async () => {
  await loadUniverse();
  freshness();
  const q = new URLSearchParams(location.search).get("cmd");
  await run(q || "help", { record: !!q });
  if (!q) input.focus();
})();
