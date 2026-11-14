/* IDX Lite: tampilan utama (menu, pencarian, halaman saham bertab) di atas core.js. */
"use strict";

const TABS = [
  ["ringkasan", "Ringkasan", "brief"], ["teknikal", "Teknikal", "technical"], ["fundamental", "Fundamental", "fundamental"],
  ["analis", "Analis", "analyst"], ["kepemilikan", "Kepemilikan", "ownership"], ["broker", "Broker", "broker"], ["foreign", "Foreign", "foreign"], ["bandar", "Bandar", "bandar"],
];
const PAGES = {
  pasar: { title: "Pasar hari ini", desc: "Indikator makro, saham naik dan turun terbanyak, yang paling aktif, aliran dana asing, dan broker teratas.", cmd: "market" },
  beli: { title: "Time to buy", desc: "Watchlist saham yang sedang memberi sinyal beli menurut teknikal, fundamental, atau keduanya. Dihitung ulang setiap sore setelah harga diperbarui.", cmd: "buy" },
  ai: { title: "Laporan AI", desc: "Laporan otomatis setelah sesi 1 dan setelah penutupan: angka dihitung skrip, narasinya ditulis AI. Juga dikirim ke Telegram.", cmd: "ai" },
  makro: { title: "Makro", desc: "Kurs, IHSG, minyak, yield SBN dan CDS, dengan grafik tren.", cmd: "macro" },
  foreign: { title: "Foreign flow", desc: "Saham yang paling banyak dibeli dan dijual investor asing pada sesi terakhir. Ketuk kode saham untuk riwayatnya.", cmd: "foreign" },
  broker: { title: "Broker", desc: "Ranking broker seluruh pasar pada sesi terakhir. Ketuk kode broker untuk melihat saham yang ia beli dan jual.", cmd: "brokers" },
  bandar: { title: "Bandarmology", desc: "Apakah broker terbesar sedang mengumpulkan (akumulasi) atau melepas (distribusi) saham? Dihitung untuk 100 saham paling aktif.", cmd: "bandar screen" },
  screener: { title: "Screener", desc: "Cari saham dengan kriteria harga, teknikal dan fundamental.", cmd: null },
  kepemilikan: { title: "Kepemilikan", desc: "Pemegang saham di atas 1% dari register KSEI bulanan: siapa yang masuk, keluar, menambah dan mengurangi.", cmd: "ownership" },
  hsc: { title: "Saham HSC", desc: "Saham dengan kepemilikan sangat terkonsentrasi menurut BEI. Free float-nya kecil, jadi harganya mudah bergerak tajam.", cmd: "hsc" },
  x: { title: "Hasil", desc: "", cmd: null },
};
const TAB_OF = { quote: "ringkasan", brief: "ringkasan", technical: "teknikal", fundamental: "fundamental", analyst: "analis", ownership: "kepemilikan", broker: "broker", foreign: "foreign", bandar: "bandar" };
const PAGE_OF = { buy: "beli", ai: "ai", market: "pasar", macro: "makro", foreign: "foreign", brokers: "broker", "bandar screen": "bandar", "bandar broker": "broker", screen: "screener", hsc: "hsc", ownership: "kepemilikan" };

const view = $("#view");

/* ---------- rute ---------- */
function canon(cmd) {
  const k = Object.keys(COMMANDS).find((n) => COMMANDS[n] === cmd);
  return k ? COMMANDS[k].alias || k : null;
}
/* Ubah perintah (dari tombol di hasil, atau ketikan di kotak cari) menjadi alamat halaman. */
function routeFor(line) {
  line = String(line).trim();
  const [cmd, rest] = resolve(tokenize(line));
  if (!cmd) return null;
  const name = canon(cmd), a = parseArgs(rest);
  if (TAB_OF[name] && a.pos[0]) return `#/s/${a.pos[0].toUpperCase().replace(/\.JK$/, "")}/${TAB_OF[name]}`;
  const page = PAGE_OF[name] || "x";
  const path = page === "pasar" ? "#/" : `#/${page}`;
  return line === PAGES[page].cmd ? path : `${path}?c=${encodeURIComponent(line)}`;
}
function parseRoute() {
  const [path, qs] = location.hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "s" && parts[1]) return { stock: parts[1].toUpperCase(), tab: parts[2] || "ringkasan" };
  const page = PAGES[parts[0]] ? parts[0] : "pasar";
  return { page, c: new URLSearchParams(qs || "").get("c") };
}
const go = (route) => { if (route) location.hash = route; };

/* ---------- menjalankan perintah ke dalam satu elemen ---------- */
async function exec(line, el) {
  el.innerHTML = `<div class="loading">Memuat…</div>`;
  try {
    const [cmd, rest] = resolve(tokenize(line));
    need(cmd, `Perintah "${line}" tidak dikenal.`);
    const out = await cmd.fn(parseArgs(rest), el, null);
    if (typeof out === "string") el.innerHTML = out;
  } catch (e) {
    el.innerHTML = `<div class="empty err">${esc(e instanceof UserError ? e.message : "Gagal memuat: " + e.message)}</div>`;
    if (!(e instanceof UserError)) console.error(e);
  }
}

/* ---------- halaman saham ---------- */
async function renderStock(sym, tab) {
  let s;
  try { s = await stock(sym); } catch (e) {
    view.innerHTML = `<div class="empty err">${esc(e.message)}</div>`;
    return;
  }
  const t = TABS.find((x) => x[0] === tab) || TABS[0];
  document.title = `${sym} · ${t[1]} · IDX Lite`;
  view.innerHTML = `
    <section class="stock-head">
      <div class="sh-top"><h1>${esc(sym)}${HSC_SET.has(sym) ? `<span class="hsc">HSC</span>` : ""}</h1><button class="star" data-watch="${esc(sym)}" aria-pressed="${watchHas(sym)}" title="Tambah ke / hapus dari watchlist saya">${watchHas(sym) ? "★" : "☆"}</button><span class="nm">${esc(NAMES[sym] || "")}</span></div>
      <div class="sh-px"><span class="px">${nf(s.price)}</span>${pct(s.change_pct)}<span class="muted">${esc(s.date)}${s.stale ? " · belum ada transaksi/data sesi terakhir" : ""}</span></div>
    </section>
    ${HSC_SET.has(sym) ? hscFlag(sym) : ""}
    <nav class="tabs" role="tablist" aria-label="Bagian">${TABS.map(([id, label]) =>
      `<a role="tab" href="#/s/${esc(sym)}/${id}" aria-selected="${id === t[0]}">${label}</a>`).join("")}</nav>
    <div class="pane" id="pane"></div>`;
  await exec(`${t[2]} ${sym}`, $("#pane"));
}

/* ---------- halaman menu ---------- */
async function renderPage(r) {
  const p = PAGES[r.page];
  document.title = `${p.title} · IDX Lite`;
  view.innerHTML = `
    <section class="page-head"><h1>${p.title}</h1>${p.desc ? `<p class="muted">${p.desc}</p>` : ""}</section>
    <div class="controls"></div>
    <div class="pane" id="pane"></div>`;
  const controls = $(".controls", view);
  if (r.page === "screener") screenerForm(controls, r.c);
  if (r.page === "bandar") bandarControls(controls, r.c);
  if (r.page === "broker") brokerControls(controls, r.c);
  const line = r.c || p.cmd;
  if (line) await exec(line, $("#pane"));
  else $("#pane").innerHTML = `<div class="empty">Isi kriteria di atas, atau pilih salah satu contoh, lalu tekan <b>Cari saham</b>.</div>`;
}

/* Bandar: pilihan periode dan jenis sinyal sebagai tombol */
const BANDAR_PRESETS = [
  ["", "Semua"], ["big-accumulation", "Akumulasi besar"], ["accumulation", "Akumulasi"], ["quiet-accumulation", "Akumulasi diam-diam"],
  ["foreign-accumulation", "Akumulasi + asing"], ["below-bandar", "Di bawah harga bandar"], ["distribution", "Distribusi"], ["big-distribution", "Distribusi besar"],
];
function bandarControls(el, c) {
  const a = parseArgs(tokenize(c || "bandar screen").slice(2));
  const period = String(a.flags.period || "1w"), preset = String(a.flags.preset || a.pos[0] || "");
  const build = (p, pr) => routeFor(`bandar screen --period ${p}${pr ? ` --preset ${pr}` : ""}`);
  el.innerHTML = `
    <div class="seg" role="group" aria-label="Periode">${[["1w", "1 minggu"], ["1d", "1 hari"]].map(([v, l]) =>
      `<button data-go="${build(v, preset)}" aria-pressed="${v === period}">${l}</button>`).join("")}</div>
    <div class="chips">${BANDAR_PRESETS.map(([v, l]) => `<button class="chip" data-go="${build(period, v)}" aria-pressed="${v === preset}">${l}</button>`).join("")}</div>`;
}

/* Broker: cari kode broker */
function brokerControls(el, c) {
  const code = /^bandar broker\s+(\S+)/i.exec(c || "")?.[1] || "";
  el.innerHTML = `
    <form class="inline" data-broker-form>
      <label for="bcode">Lihat aktivitas satu broker</label>
      <div class="pair"><input id="bcode" placeholder="Kode broker, mis. YP" value="${esc(code)}" maxlength="4" autocapitalize="characters">
      <button class="primary">Lihat</button>${code ? `<button type="button" class="ghost" data-go="#/broker">Semua broker</button>` : ""}</div>
    </form>`;
  el.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#bcode").value.trim().toUpperCase();
    if (v) go(routeFor(`bandar broker ${v}`));
  });
}

/* Screener: formulir yang diterjemahkan ke filter perintah screen */
const SF = [
  ["pmin", "price>=", "Harga min (Rp)"], ["pmax", "price<=", "Harga maks (Rp)"], ["vmin", "value>=", "Nilai transaksi min (miliar Rp)", "B"],
  ["rmin", "rsi>=", "RSI min"], ["rmax", "rsi<=", "RSI maks"], ["cmin", "chg>=", "Naik hari ini min (%)"],
  ["pe", "pe<=", "P/E maks"], ["roe", "roe>=", "ROE min (%)"], ["div", "div>=", "Dividen min (%)"],
];
const SC = [["a20", "price>sma20", "Harga di atas SMA20"], ["a50", "price>sma50", "Harga di atas SMA50"], ["up", "sma20>sma50", "SMA20 di atas SMA50 (tren naik)"], ["nohsc", "hsc=0", "Kecualikan saham HSC"]];
const SORTS = [["value", "Nilai transaksi"], ["chg", "Kenaikan hari ini"], ["rsi", "RSI"], ["pe", "P/E"], ["roe", "ROE"], ["div", "Dividen"], ["mcap", "Kapitalisasi"], ["upside", "Potensi ke target analis"]];
const SPRESETS = [
  ["Oversold & likuid", "screen rsi<=30,value>=1B,hsc=0"], ["Tren naik", "screen price>sma20,price>sma50,sma20>sma50,value>=5B,hsc=0"],
  ["Naik kuat hari ini", "screen chg>=5,value>=1B,hsc=0 --sort chg"], ["Murah & ROE tinggi", "screen pe<=10,pe>0,roe>=15,hsc=0 --sort roe"],
  ["Dividen tinggi", "screen div>=5,mcap>=10T,hsc=0 --sort div"], ["Jauh di bawah target analis", "screen upside>=30,analysts>=3,value>=1B,hsc=0 --sort upside"],
];
function screenerForm(el, c) {
  const a = parseArgs(tokenize(c || "").slice(1));
  const clauses = [a.pos.join(","), a.flags.filter].filter((x) => x && x !== true).join(",").split(",").map((x) => x.trim()).filter(Boolean);
  const val = (prefix, suffix) => {
    const hit = clauses.find((x) => x.startsWith(prefix));
    if (!hit) return "";
    const n = num(hit.slice(prefix.length));
    return n == null ? "" : suffix === "B" ? n / 1e9 : n;
  };
  const fresh = !c;
  el.innerHTML = `
    <form data-screen-form>
      <div class="chips" style="margin:0 0 12px">${SPRESETS.map(([l, cmd]) => `<button type="button" class="chip" data-go="${routeFor(cmd)}" aria-pressed="${c === cmd}">${l}</button>`).join("")}</div>
      <div class="form-grid">${SF.map(([id, p, l, s]) => `<div class="field"><label for="sf-${id}">${l}</label><input id="sf-${id}" type="number" step="any" inputmode="decimal" value="${val(p, s)}"></div>`).join("")}
        <div class="field"><label for="sf-sort">Urutkan menurut</label><select id="sf-sort">${SORTS.map(([v, l]) => `<option value="${v}" ${v === (a.flags.sort || "value") ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      </div>
      <div class="checks">${SC.map(([id, cl, l]) => `<label><input type="checkbox" id="sf-${id}" ${clauses.includes(cl) || (fresh && id === "nohsc") ? "checked" : ""}> ${l}</label>`).join("")}</div>
      <div class="actions"><button class="primary">Cari saham</button><button type="button" class="ghost" data-go="#/screener">Kosongkan</button></div>
    </form>`;
  el.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const parts = [];
    for (const [id, p, , s] of SF) {
      const v = $(`#sf-${id}`).value.trim();
      if (v !== "") parts.push(`${p}${v}${s || ""}`);
      if (id === "pe" && v !== "") parts.push("pe>0");
    }
    for (const [id, cl] of SC) if ($(`#sf-${id}`).checked) parts.push(cl);
    if (!parts.length) parts.push("value>0");
    const sort = $("#sf-sort").value;
    go(routeFor(`screen ${parts.join(",")}${sort !== "value" ? ` --sort ${sort}` : ""}`));
  });
}

/* ---------- pencarian ---------- */
const q = $("#q"), qlist = $("#qlist");
let qItems = [], qSel = -1;
function qSuggest() {
  const t = q.value.trim(), up = t.toUpperCase();
  qItems = [];
  if (t) {
    for (const s of SYMBOLS) {
      const nm = NAMES[s] || "";
      if (s.startsWith(up) || (t.length >= 3 && nm.toUpperCase().includes(up))) qItems.push([s, nm]);
      if (qItems.length >= 10) break;
    }
  }
  qSel = qItems.length ? 0 : -1;
  qlist.hidden = !qItems.length;
  q.setAttribute("aria-expanded", String(!qlist.hidden));
  qlist.innerHTML = qItems.map(([s, nm], i) =>
    `<li role="option" data-i="${i}" aria-selected="${i === qSel}"><b>${esc(s)}</b>${HSC_SET.has(s) ? `<span class="hsc">HSC</span>` : ""}<span>${esc(nm)}</span></li>`).join("");
}
const qClose = () => { qlist.hidden = true; q.setAttribute("aria-expanded", "false"); };
function qPick(sym) { q.value = ""; qClose(); q.blur(); go(`#/s/${sym}/ringkasan`); }
q.addEventListener("input", qSuggest);
q.addEventListener("keydown", (e) => {
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && qItems.length) {
    e.preventDefault();
    qSel = (qSel + (e.key === "ArrowDown" ? 1 : -1) + qItems.length) % qItems.length;
    qlist.querySelectorAll("li").forEach((li, i) => li.setAttribute("aria-selected", String(i === qSel)));
  } else if (e.key === "Escape") { qClose(); }
});
qlist.addEventListener("mousedown", (e) => { const li = e.target.closest("li"); if (li) { e.preventDefault(); qPick(qItems[li.dataset.i][0]); } });
q.addEventListener("blur", () => setTimeout(qClose, 150));
$("#search").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = q.value.trim(), up = t.toUpperCase();
  if (!t) return;
  if (SYMBOLS.includes(up)) return qPick(up);
  if (qSel >= 0 && qItems[qSel]) return qPick(qItems[qSel][0]);
  const r = routeFor(t);                    // perintah terminal juga bisa diketik di sini
  if (r) { q.value = ""; qClose(); go(r); return; }
  view.insertAdjacentHTML("afterbegin", `<div class="empty err">Saham "${esc(t)}" tidak ditemukan.</div>`);
});

/* ---------- klik di dalam hasil ---------- */
document.addEventListener("click", (e) => {
  const w = e.target.closest("[data-watch]");
  if (w) { const on = watchToggle(w.dataset.watch); w.textContent = on ? "★" : "☆"; w.setAttribute("aria-pressed", on); return; }
  const u = e.target.closest("[data-unwatch]");
  if (u) { watchToggle(u.dataset.unwatch); render(); return; }
  const g = e.target.closest("[data-go]");
  if (g) { e.preventDefault(); go(g.dataset.go); return; }
  const c = e.target.closest("[data-cmd]");
  if (c) { e.preventDefault(); go(routeFor(c.dataset.cmd)); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { e.preventDefault(); q.focus(); }
});

/* ---------- mulai ---------- */
async function render() {
  const r = parseRoute();
  document.querySelectorAll(".mainnav a").forEach((a) => a.toggleAttribute("aria-current", !r.stock && a.dataset.page === r.page));
  document.querySelectorAll(".mainnav a[aria-current]").forEach((a) => a.setAttribute("aria-current", "page"));
  window.scrollTo({ top: 0 });
  if (r.stock) await renderStock(r.stock, r.tab);
  else await renderPage(r);
}
window.addEventListener("hashchange", render);
(async () => {
  // tautan lama ?cmd=... (dari terminal) diarahkan ke halaman yang sesuai
  const legacy = new URLSearchParams(location.search).get("cmd");
  await loadUniverse();
  freshness();
  if (legacy) { history.replaceState(null, "", location.pathname + (routeFor(legacy) || "#/")); }
  render();
})();
