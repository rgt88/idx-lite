/* IDX Lite core: data, format, indikator dan semua perintah. Dipakai oleh app.js (tampilan utama)
   dan terminal.js (baris perintah). Semua dijawab dari file JSON statis di data/. */
"use strict";

/* ---------- util ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isNum = (n) => typeof n === "number" && isFinite(n);
const nf = (n, d = 0) => (isNum(n) ? n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
const big = (n) => {
  if (!isNum(n)) return "–";
  const a = Math.abs(n);
  if (a >= 1e12) return nf(n / 1e12, 2) + " T";
  if (a >= 1e9) return nf(n / 1e9, 1) + " B";
  if (a >= 1e6) return nf(n / 1e6, 1) + " M";
  if (a >= 1e3) return nf(n / 1e3, 1) + " K";
  return nf(n);
};
const cls = (v) => (!isNum(v) ? "" : v > 0 ? "up" : v < 0 ? "down" : "");
const pct = (v, d = 2) => (isNum(v) ? `<span class="${cls(v)}">${v > 0 ? "+" : ""}${nf(v, d)}%</span>` : "–");
const sgn = (v, f = big) => (isNum(v) ? `<span class="${cls(v)}">${v > 0 ? "+" : ""}${f(v)}</span>` : "–");
const symLink = (s) => `<a class="sym" data-cmd="${esc(s)}">${esc(s)}</a>${HSC_SET.has(s) ? `<span class="hsc" title="Kepemilikan saham terkonsentrasi tinggi (BEI)">HSC</span>` : ""}`;
const cmdBtn = (c, label = c) => `<button class="btn" data-cmd="${esc(c)}">${esc(label)}</button>`;
const KIND = { foreign: "Asing", local: "Lokal", state_owned: "BUMN" };
const kind = (k) => (k ? `<span class="k-${esc(k)}">${KIND[k] || esc(k)}</span>` : "–");
const codeLink = (b) => `<a class="code k-${esc(b.kind || "")}" data-cmd="bandar broker ${esc(b.code)}" title="${esc(b.name || "")}">${esc(b.code)}</a>`;
const wib = (iso) => (iso ? new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) + " WIB" : "–");
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

class UserError extends Error {}
const need = (cond, msg) => { if (!cond) throw new UserError(msg); };

/* ---------- data ---------- */
const store = new Map();
async function getJSON(path, optional = false) {
  if (!store.has(path)) {
    store.set(path, fetch("data/" + path, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`data/${path}: HTTP ${r.status}`);
      return r.json();
    }));
  }
  try {
    return await store.get(path);
  } catch (e) {
    store.delete(path);
    if (optional) return null;
    throw e;
  }
}
const summary = () => getJSON("summary.json");
const prices = (s) => getJSON(`prices/${s}.json`, true);
const fundIndex = async () => (await getJSON("fundamentals.json", true))?.stocks || {};
const bandarScreen = (p) => getJSON(`flow/bandar_${p}.json`, true);
const brokerOf = (s) => getJSON(`flow/broker/${s}.json`, true);

let SYMBOLS = [];
let NAMES = {};
let HSC = null, HSC_SET = new Set(), FLOW_META = null;
const tgl = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "?");
const hscDetail = (sym) => HSC?.details?.[sym] || null;
const hscSrc = () => (HSC?.ref ? `Pengumuman ${esc(HSC.ref)}` : "Pengumuman BEI") + ` ${tgl(HSC?.as_of)}` +
  (HSC?.source ? ` · <a href="${esc(HSC.source)}" target="_blank" rel="noopener">sumber</a>` : "");
function hscFlag(sym) {
  const d = hscDetail(sym);
  const conc = d ? ` 10 pemegang terbesar menguasai <b>${nf(d.pct, 2)}%</b>${HSC.evaluated ? ` (per ${tgl(HSC.evaluated)})` : ""}.` : "";
  const mark = d?.mark && HSC.marks?.[d.mark] ? ` <b>${esc(d.mark)}</b> ${esc(HSC.marks[d.mark])}` : "";
  const ihsg = d?.new && HSC?.effective ? `Saham ini dikeluarkan dari perhitungan IHSG mulai ${tgl(HSC.effective)}.` : "Saham HSC tidak dihitung dalam IHSG.";
  return `<div class="flag" role="note"><b>⚑ HSC</b> ${esc(sym)} masuk daftar <b>Kepemilikan Saham Terkonsentrasi Tinggi</b>${d?.new ? " (baru)" : ""}.${conc}${mark}
    ${ihsg} Free float yang kecil membuat harga mudah bergerak tajam dan likuiditas tipis, sehingga indikator teknikal dan sinyal bandar lebih mudah menyesatkan.
    <br><span class="muted">${hscSrc()}</span></div>`;
}
async function loadUniverse() {
  HSC = await getJSON("hsc.json", true);
  FLOW_META = await getJSON("flow/meta.json", true);
  HSC_SET = new Set(HSC?.codes || []);
  try {
    SYMBOLS = (await summary()).stocks.map((x) => x.symbol).sort();
  } catch (e) { SYMBOLS = []; }
  for (const p of ["1d", "1w"]) {
    const b = await bandarScreen(p);
    for (const r of b?.data?.rows || []) if (r.name) NAMES[r.symbol] = r.name;
  }
}
async function stock(sym) {
  const s = (await summary()).stocks.find((x) => x.symbol === sym);
  need(s, `Kode ${sym} tidak ada di data harga. Cek ejaannya, atau saham ini belum/tidak lagi diperdagangkan.`);
  return s;
}
const symArg = (a) => {
  need(a.pos[0], "Perintah ini butuh kode saham, misalnya BBCA.");
  return a.pos[0].toUpperCase().replace(/\.JK$/, "");
};

/* ---------- argumen & filter ---------- */
function tokenize(line) {
  return line.match(/"[^"]*"|'[^']*'|\S+/g)?.map((t) => t.replace(/^["']|["']$/g, "")) || [];
}
const SHORT = { p: "period", f: "filter", n: "top", l: "limit", s: "sort" };
function parseArgs(tokens) {
  const a = { pos: [], flags: {} };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const m = t.match(/^--?([a-z][\w-]*)(?:=(.*))?$/i);
    if (!m) { a.pos.push(t); continue; }
    const key = SHORT[m[1]] || m[1];
    if (m[2] !== undefined) a.flags[key] = m[2];
    else if (i + 1 < tokens.length && !/^--?[a-z]/i.test(tokens[i + 1])) a.flags[key] = tokens[++i];
    else a.flags[key] = true;
  }
  return a;
}
function num(text) {
  const m = String(text).trim().match(/^(-?\d+(?:[.,]\d+)?)\s*([kmbt]?)$/i);
  if (!m) return null;
  const mult = { "": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2].toLowerCase()];
  return parseFloat(m[1].replace(",", ".")) * mult;
}
/* "acc>=5,phase=markup,price>sma20" -> fungsi saringan; keyMap: nama -> fungsi(row) */
function compileFilter(text, keyMap) {
  if (!text) return () => true;
  const tests = String(text).split(",").map((c) => c.trim()).filter(Boolean).map((c) => {
    const m = c.match(/^([a-z_0-9]+)\s*(>=|<=|!=|=|>|<)\s*(.+)$/i);
    need(m, `Klausa "${c}" tidak dikenali. Contoh: rsi<30, value>1B, price>sma20.`);
    const [, k, op, raw] = m;
    const get = keyMap[k.toLowerCase()];
    need(get, `Kunci "${k}" tidak dikenali. Pilihan: ${Object.keys(keyMap).join(", ")}.`);
    const other = keyMap[raw.toLowerCase()];
    const n = num(raw);
    const rhs = other ? other : n != null ? () => n : () => raw.toLowerCase().replace(/-/g, "_");
    return (row) => {
      const x = get(row), y = rhs(row);
      if (x == null || y == null) return false;
      if (typeof x === "string" || typeof y === "string") {
        const eq = String(x).toLowerCase() === String(y).toLowerCase();
        return op === "!=" ? !eq : op === "=" ? eq : false;
      }
      return { ">=": x >= y, "<=": x <= y, ">": x > y, "<": x < y, "=": x === y, "!=": x !== y }[op];
    };
  });
  return (row) => tests.every((t) => t(row));
}
function sortRows(rows, get, asc) {
  return rows.slice().sort((a, b) => {
    const x = get(a), y = get(b);
    if (x == null) return 1;
    if (y == null) return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * (asc ? 1 : -1);
  });
}

/* ---------- tampilan ---------- */
function table(cols, rows, empty = "Tidak ada baris.") {
  const head = cols.map((c) => `<th class="${c.n ? "n" : ""}" ${c.t ? `title="${esc(c.t)}"` : ""}>${c.h}</th>`).join("");
  const body = rows.length
    ? rows.map((r, i) => `<tr>${cols.map((c) => `<td class="${c.n ? "n" : ""}">${c.f ? c.f(r, i) : esc(r[c.k] ?? "–")}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${cols.length}" class="muted">${empty}</td></tr>`;
  return `<div class="tw"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
const kv = (pairs) => `<div class="kv">${pairs.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>`;
const card = (l, v, s = "") => `<div class="card"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
function envNote(env) {
  if (!env) return "";
  const w = (env.warnings || []).map((x) => `<br>⚠ ${esc(x)}`).join("");
  return `<p class="note">Diambil ${wib(env.fetched_at)}${env.provider ? ` · sumber ${esc(env.provider)}` : ""}${env.stale ? " · salinan lama" : ""}${w}</p>`;
}
function flowProblem() {
  const st = Object.values(FLOW_META?.status || {}).map(String);
  const why = new Set();
  for (const x of st) {
    if (/HTTP 5\d\d/.test(x)) why.add("server Indo Premier sedang error");
    else if (/blocked|Cloudflare/i.test(x)) why.add("idx.co.id menolak koneksi (proteksi Cloudflare)");
    else if (/no session with trades/.test(x)) why.add("Indo Premier belum menerbitkan data sesi terakhir");
    else if (/exit 2/.test(x)) why.add("versi CLI idx belum mendukung salah satu perintah");
    else if (/timeout/.test(x)) why.add("sumber terlalu lama menjawab");
  }
  return why.size ? `Pengambilan terakhir (${wib(FLOW_META.updated)}) gagal karena ${[...why].join(" dan ")}. Data akan dicoba lagi otomatis setiap hari bursa pukul 19:30 WIB.` : "";
}
const flowMissing = (what) => {
  const p = flowProblem();
  return `<div class="empty"><b>${what} belum tersedia.</b><p>${p || "Data ini diambil sekali sehari setelah 19:00 WIB untuk 100 saham paling aktif; saham di luar itu tidak punya data."}</p></div>`;
};

function mkChart(el, fmt) {
  return LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: "system-ui, sans-serif" },
    grid: { vertLines: { color: "rgba(128,128,128,.12)" }, horzLines: { color: "rgba(128,128,128,.12)" } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
    localization: { locale: "id-ID", priceFormatter: fmt || ((p) => nf(p, Math.abs(p) < 10 ? 2 : 0)) },
  });
}
const chartReady = () => typeof LightweightCharts !== "undefined";

/* ---------- indikator ---------- */
const smaA = (v, n) => { const o = []; let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; o.push(i >= n - 1 ? s / n : null); } return o; };
const emaA = (v, n) => { const k = 2 / (n + 1), o = []; let e = null, c = 0; for (const x of v) { if (x == null) { o.push(null); continue; } e = e == null ? x : x * k + e * (1 - k); c++; o.push(c >= n ? e : null); } return o; };
function rsiA(v, n = 14) {
  const o = [null]; let up = 0, dn = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
    if (i <= n) { up += u / n; dn += w / n; o.push(i === n ? (dn === 0 ? 100 : 100 - 100 / (1 + up / dn)) : null); }
    else { up = (up * (n - 1) + u) / n; dn = (dn * (n - 1) + w) / n; o.push(dn === 0 ? 100 : 100 - 100 / (1 + up / dn)); }
  }
  return o;
}
function indicators(rows) {
  const t = rows.map((r) => r[0]), h = rows.map((r) => r[2]), l = rows.map((r) => r[3]), c = rows.map((r) => r[4]), vol = rows.map((r) => r[5]);
  const s20 = smaA(c, 20), s50 = smaA(c, 50), s200 = smaA(c, 200);
  const sd = s20.map((m, i) => { if (m == null) return null; let q = 0; for (let j = i - 19; j <= i; j++) q += (c[j] - m) ** 2; return Math.sqrt(q / 20); });
  const e12 = emaA(c, 12), e26 = emaA(c, 26);
  const macd = c.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null));
  const tr = c.map((_, i) => (i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
  return {
    t, h, l, c, vol, s20, s50, s200, macd, sigl: emaA(macd, 9), ema20: emaA(c, 20), rsi: rsiA(c),
    vma20: smaA(vol, 20), atr: emaA(tr, 14),
    bbU: s20.map((m, i) => (m == null ? null : m + 2 * sd[i])), bbL: s20.map((m, i) => (m == null ? null : m - 2 * sd[i])),
  };
}
function signals(ind) {
  const n = ind.c.length - 1, out = [], add = (txt, k = "") => out.push([txt, k]);
  if (n < 1) return out;
  const c = ind.c[n];
  for (const [arr, name] of [[ind.s20, "SMA20"], [ind.s50, "SMA50"], [ind.s200, "SMA200"]])
    if (arr[n] != null) add(c > arr[n] ? `Di atas ${name}` : `Di bawah ${name}`, c > arr[n] ? "bull" : "bear");
  for (let i = Math.max(1, n - 9); i <= n; i++) {
    const a = ind.s20[i], b = ind.s50[i], a0 = ind.s20[i - 1], b0 = ind.s50[i - 1];
    if ([a, b, a0, b0].some((x) => x == null)) continue;
    if (a0 <= b0 && a > b) add(`Golden cross ${ind.t[i]}`, "bull");
    if (a0 >= b0 && a < b) add(`Death cross ${ind.t[i]}`, "bear");
  }
  const r = ind.rsi[n];
  if (r != null) add(`RSI ${nf(r, 1)}${r < 30 ? " · oversold" : r > 70 ? " · overbought" : ""}`, r < 30 ? "bull" : r > 70 ? "bear" : "");
  const m = ind.macd[n], sg = ind.sigl[n], m0 = ind.macd[n - 1], sg0 = ind.sigl[n - 1];
  if (m != null && sg != null) {
    const crossed = m0 != null && sg0 != null && (m0 - sg0) * (m - sg) < 0;
    add(crossed ? (m > sg ? "MACD baru cross naik" : "MACD baru cross turun") : m > sg ? "MACD di atas sinyal" : "MACD di bawah sinyal", m > sg ? "bull" : "bear");
  }
  if (ind.bbU[n] != null) { if (c > ind.bbU[n]) add("Tembus Bollinger atas", "bear"); else if (c < ind.bbL[n]) add("Tembus Bollinger bawah", "bull"); }
  if (ind.vma20[n]) { const rv = ind.vol[n] / ind.vma20[n]; if (rv >= 2) add(`Volume ${nf(rv, 1)}× rata-rata 20 hari`); }
  return out;
}
const tagsHtml = (sig) => `<div class="tags">${sig.map(([t, k]) => `<span class="tag ${k}">${esc(t)}</span>`).join("")}</div>`;
const lineData = (t, v) => t.map((time, i) => (v[i] == null ? { time } : { time, value: v[i] }));

function priceChart(el, rows) {
  if (!chartReady()) { el.outerHTML = `<p class="muted">Pustaka grafik gagal dimuat.</p>`; return; }
  const chart = mkChart(el);
  const candles = chart.addCandlestickSeries({ upColor: css("--up"), downColor: css("--down"), wickUpColor: css("--up"), wickDownColor: css("--down"), borderVisible: false });
  const ln = (color) => chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  const s20 = ln("#2f6fde"), s50 = ln("#e59500");
  const vol = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
  chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  const ind = indicators(rows);
  candles.setData(rows.map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4] })));
  s20.setData(lineData(ind.t, ind.s20));
  s50.setData(lineData(ind.t, ind.s50));
  vol.setData(rows.map((r) => ({ time: r[0], value: r[5], color: r[4] >= r[1] ? "rgba(17,128,74,.35)" : "rgba(198,40,40,.35)" })));
  return chart;
}
function rangeButtons(chart, rows, holder) {
  const spans = { "1M": 22, "3M": 66, "6M": 130, "1Y": 260 };
  holder.innerHTML = Object.keys(spans).map((k) => `<button class="btn" data-span="${k}" aria-pressed="${k === "6M"}">${k}</button>`).join("");
  const set = (k) => {
    const n = rows.length, from = rows[Math.max(0, n - spans[k])][0];
    chart.timeScale().setVisibleRange({ from, to: rows[n - 1][0] });
    holder.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.span === k));
  };
  holder.addEventListener("click", (e) => { const b = e.target.closest("[data-span]"); if (b) set(b.dataset.span); });
  requestAnimationFrame(() => set("6M"));
}

/* ---------- perintah ---------- */
const COMMANDS = {};
function def(name, usage, desc, fn, aliases = []) {
  COMMANDS[name] = { usage, desc, fn };
  for (const a of aliases) COMMANDS[a] = { alias: name, usage, desc, fn };
}

def("help", "help", "Daftar perintah ini.", async () => {
  const seen = new Set();
  const rows = Object.entries(COMMANDS).filter(([, c]) => !c.alias && !seen.has(c.usage) && seen.add(c.usage));
  return `<div class="help"><dl>${rows.map(([, c]) => `<dt><a class="code" data-cmd="${esc(c.example || c.usage)}">${esc(c.usage)}</a></dt><dd>${c.desc}</dd>`).join("")}</dl>
  <p class="note">Ketik kode saham saja (mis. <a class="code" data-cmd="BBCA">BBCA</a>) untuk melihat harganya. Angka boleh memakai akhiran K, M (juta), B (miliar), T (triliun). Tabel ditulis dengan K/M/B/T yang sama.</p></div>`;
}, ["?"]);

def("quote", "quote BBCA", "Harga, grafik candlestick 1 tahun, SMA dan sinyal teknikal singkat.", async (a, body) => {
  const sym = symArg(a);
  const s = await stock(sym);
  const rows = await prices(sym);
  const f = (await fundIndex())[sym] || {};
  const ind = rows ? indicators(rows) : null;
  const hi = rows ? Math.max(...rows.slice(-250).map((r) => r[2])) : null;
  const lo = rows ? Math.min(...rows.slice(-250).map((r) => r[3])) : null;
  body.innerHTML = `
    <div class="quote-head"><span class="px">${nf(s.price)}</span>${pct(s.change_pct)}<b>${esc(sym)}</b><span class="nm">${esc(NAMES[sym] || "")}</span><span class="muted">${esc(s.date)}</span></div>
    ${kv([["Volume", big(s.volume)], ["Nilai", big(s.value)], ["SMA20", nf(s.sma20)], ["SMA50", nf(s.sma50)], ["RSI 14", nf(s.rsi14, 1)],
          ["High 1 th", nf(hi)], ["Low 1 th", nf(lo)], ["P/E", nf(f.pe, 1)], ["P/B", nf(f.pb, 2)], ["Div", isNum(f.div_yield) ? nf(f.div_yield, 2) + "%" : "–"], ["Mkt cap", big(f.mcap)]])}
    ${ind ? tagsHtml(signals(ind)) : ""}
    <div class="btns rel">${["technical", "fundamental", "broker", "foreign", "bandar"].map((c) => cmdBtn(`${c} ${sym}`, c)).join("")}</div>
    ${rows ? `<div class="btns" data-range></div><div class="chart"></div><div class="legend">Biru = SMA20 · Oranye = SMA50 · Batang = volume</div>` : `<p class="muted">Riwayat harga belum ada.</p>`}`;
  if (rows) { const ch = priceChart($(".chart", body), rows); if (ch) rangeButtons(ch, rows, $("[data-range]", body)); }
}, ["q"]);

def("technical", "technical BBCA", "RSI, MACD, SMA/EMA, Bollinger, ATR, support/resistance dan sinyal.", async (a, body) => {
  const sym = symArg(a);
  await stock(sym);
  const rows = await prices(sym);
  need(rows && rows.length > 30, `Riwayat harga ${sym} terlalu pendek untuk indikator.`);
  const ind = indicators(rows), n = rows.length - 1, c = ind.c[n];
  const sig = signals(ind);
  const bull = sig.filter((x) => x[1] === "bull").length, bear = sig.filter((x) => x[1] === "bear").length;
  const read = bull - bear >= 2 ? `<span class="up">cenderung naik</span>` : bear - bull >= 2 ? `<span class="down">cenderung turun</span>` : "netral / campuran";
  const last20 = rows.slice(-20);
  body.innerHTML = `
    <p><b>${esc(sym)}</b> ${nf(c)} · pembacaan indikator: ${read} (${bull} positif, ${bear} negatif)</p>
    ${tagsHtml(sig)}
    ${kv([["SMA20", nf(ind.s20[n])], ["SMA50", nf(ind.s50[n])], ["SMA200", nf(ind.s200[n])], ["EMA20", nf(ind.ema20[n])],
          ["RSI 14", nf(ind.rsi[n], 1)], ["MACD", nf(ind.macd[n], 1)], ["Sinyal MACD", nf(ind.sigl[n], 1)], ["Histogram", nf(ind.macd[n] - ind.sigl[n], 1)],
          ["Bollinger atas", nf(ind.bbU[n])], ["Bollinger bawah", nf(ind.bbL[n])], ["ATR 14", nf(ind.atr[n])], ["ATR %", nf((ind.atr[n] / c) * 100, 2) + "%"],
          ["Support 20 hr", nf(Math.min(...last20.map((r) => r[3])))], ["Resistance 20 hr", nf(Math.max(...last20.map((r) => r[2])))],
          ["Volume / rata2 20", nf(ind.vol[n] / ind.vma20[n], 2) + "×"]])}
    <h3>RSI 14</h3><div class="chart sm"></div>
    <p class="note">Indikator dihitung dari harga harian sampai ${esc(ind.t[n])}. Pembacaan ini bukan rekomendasi; sinyal teknikal sering keliru, terutama di saham tidak likuid.</p>`;
  if (chartReady()) {
    const ch = mkChart($(".chart.sm", body));
    const rs = ch.addLineSeries({ color: "#8b5cf6", lineWidth: 1, priceLineVisible: false });
    rs.setData(lineData(ind.t, ind.rsi));
    [30, 70].forEach((price) => rs.createPriceLine({ price, color: "rgba(128,128,128,.6)", lineStyle: 2, lineWidth: 1, axisLabelVisible: true }));
    ch.timeScale().fitContent();
  }
}, ["ta", "tech"]);

def("fundamental", "fundamental BBCA", "Valuasi dan kinerja kuartalan/tahunan (pendapatan, laba, QoQ, YoY).", async (a, body) => {
  const sym = symArg(a);
  const f = (await fundIndex())[sym] || {};
  const d = await getJSON(`fundamentals/${sym}.json`, true);
  need(d || Object.keys(f).length, `Fundamental ${sym} belum diambil. Data ini diperbarui bertahap, 100 saham per hari.`);
  const qLabel = (s) => `${s.slice(0, 4)} Q${Math.ceil(Number(s.slice(5, 7)) / 3)}`;
  const tbl = (rows, annual) => table([
    { h: annual ? "Tahun" : "Kuartal", f: (r) => (annual ? r.date.slice(0, 4) : qLabel(r.date)) },
    { h: "Pendapatan", n: 1, f: (r) => big(r.revenue) },
    ...(annual ? [] : [{ h: "QoQ", n: 1, f: (r) => pct(r.rev_qoq, 1) }]),
    { h: "YoY", n: 1, f: (r) => pct(r.rev_yoy, 1) },
    { h: "Laba bersih", n: 1, f: (r) => big(r.net_income) },
    ...(annual ? [] : [{ h: "QoQ", n: 1, f: (r) => pct(r.ni_qoq, 1) }]),
    { h: "YoY", n: 1, f: (r) => pct(r.ni_yoy, 1) },
    { h: "EPS", n: 1, f: (r) => nf(r.eps, 2) },
  ], (rows || []).slice().reverse(), "Tidak ada data.");
  body.innerHTML = `
    ${kv([["P/E", nf(f.pe, 1)], ["P/B", nf(f.pb, 2)], ["Dividen", isNum(f.div_yield) ? nf(f.div_yield, 2) + "%" : "–"], ["ROE", isNum(f.roe) ? nf(f.roe, 1) + "%" : "–"], ["Mkt cap", big(f.mcap)], ["Diambil", esc(f.fetched || "–")]])}
    <h3>Kuartalan</h3>${tbl(d?.quarters, false)}
    <h3>Tahunan</h3>${tbl(d?.annual, true)}
    <p class="note">Sumber Yahoo Finance, mata uang laporan ${esc(d?.currency || "?")}. Kuartal yang tidak tersedia tampil kosong. Cocokkan dengan laporan resmi.</p>`;
}, ["fund", "f"]);

def("broker", "broker BBCA", "Broker summary sesi terakhir: 10 pembeli dan penjual terbesar, rata-rata harga, foreign net.", async (a, body) => {
  const sym = symArg(a);
  const env = await brokerOf(sym);
  if (!env) return flowMissing(`Broker summary ${sym}`);
  const d = env.data;
  const side = (list, label) => table([
    { h: "#", n: 1, k: "rank" },
    { h: label, f: codeLink },
    { h: "Jenis", f: (b) => kind(b.kind) },
    { h: "Lot", n: 1, f: (b) => big(b.lots) },
    { h: "Nilai", n: 1, f: (b) => big(b.value) },
    { h: "Rata2", n: 1, f: (b) => nf(b.average_price) },
  ], list || []);
  const tiers = [1, 3, 5, 10].map((k) => {
    const sum = (l, f) => (l || []).slice(0, k).reduce((s, b) => s + (b[f] || 0), 0);
    const buy = sum(d.buyers, "value"), sell = sum(d.sellers, "value"), net = buy - sell;
    return { top: k, buy, sell, net, pctv: d.total_value ? (net / d.total_value) * 100 : null };
  });
  return `
    ${kv([["Sesi", esc(d.from === d.to ? d.to : `${d.from} – ${d.to}`)], ["Nilai transaksi", big(d.total_value)], ["Volume", big(d.total_lots) + " lot"],
          ["Rata-rata", nf(d.average_price)], ["Foreign net", sgn(d.foreign_net_value)]])}
    <div class="grid"><div><h3>Pembeli</h3>${side(d.buyers, "Beli")}</div><div><h3>Penjual</h3>${side(d.sellers, "Jual")}</div></div>
    <h3>Net top-N (beli – jual)</h3>
    ${table([{ h: "Top", k: "top" }, { h: "Beli", n: 1, f: (r) => big(r.buy) }, { h: "Jual", n: 1, f: (r) => big(r.sell) }, { h: "Net", n: 1, f: (r) => sgn(r.net) }, { h: "% nilai", n: 1, f: (r) => pct(r.pctv, 1) }], tiers)}
    <div class="btns rel">${cmdBtn(`bandar ${sym}`)}${cmdBtn(`foreign ${sym}`)}${cmdBtn(`quote ${sym}`)}</div>
    <p class="note">IPOT hanya menerbitkan 10 broker teratas per sisi, diurutkan menurut lot${d.rounded ? "; angka ≥ 1 juta dibulatkan sumbernya" : ""}. Klik kode broker untuk melihat saham lain yang ia transaksikan.</p>
    ${envNote(env)}`;
}, ["bs"]);

def("foreign", "foreign [BBCA]", "Tanpa kode: net beli/jual asing di 100 saham teraktif. Dengan kode: riwayat foreign harian.", async (a, body) => {
  if (!a.pos[0]) return marketForeign(a);
  const sym = symArg(a);
  const env = await getJSON(`flow/foreign/${sym}.json`, true);
  let days, totals = null;
  if (env) {
    days = env.data.days.map((d) => ({ date: d.date, net: d.foreign_net_value, buy: d.foreign_buy_value, sell: d.foreign_sell_value, value: d.value, share: d.foreign_share_pct, avg: d.average_price }));
    totals = env.data.totals;
  } else {
    const hist = await getJSON("flow/foreign_hist.json", true);
    days = Object.entries(hist?.sessions || {}).filter(([, m]) => m[sym]).map(([date, m]) => ({ date, net: m[sym][0], value: m[sym][1], chg: m[sym][2] })).sort((x, y) => (x.date < y.date ? -1 : 1));
  }
  if (!days?.length) return flowMissing(`Riwayat foreign ${sym}`);
  let cum = 0;
  days.forEach((d) => { cum += d.net || 0; d.cum = cum; });
  body.innerHTML = `
    ${totals ? kv([["Sesi", nf(totals.sessions)], ["Foreign beli", big(totals.foreign_buy_value)], ["Foreign jual", big(totals.foreign_sell_value)],
                   ["Foreign net", sgn(totals.foreign_net_value)], ["Porsi asing", nf(totals.foreign_share_pct, 1) + "%"],
                   ["Hari net beli / jual", `${totals.net_buy_sessions} / ${totals.net_sell_sessions}`],
                   ["Streak", totals.streak > 0 ? `<span class="up">${totals.streak} hari net beli</span>` : totals.streak < 0 ? `<span class="down">${-totals.streak} hari net jual</span>` : "–"]])
             : kv([["Sesi tercatat", nf(days.length)], ["Kumulatif net", sgn(cum)]])}
    <div class="chart sm"></div><div class="legend">Batang = foreign net harian · Garis = kumulatif</div>
    <h3>Harian</h3>
    ${table([{ h: "Tanggal", k: "date" }, { h: "Net", n: 1, f: (d) => sgn(d.net) }, { h: "Beli", n: 1, f: (d) => big(d.buy) }, { h: "Jual", n: 1, f: (d) => big(d.sell) },
             { h: "Nilai transaksi", n: 1, f: (d) => big(d.value) }, { h: "Porsi asing", n: 1, f: (d) => (isNum(d.share) ? nf(d.share, 1) + "%" : "–") }, { h: "Kumulatif", n: 1, f: (d) => sgn(d.cum) }],
            days.slice().reverse())}
    <div class="btns rel">${cmdBtn(`broker ${sym}`)}${cmdBtn(`bandar ${sym}`)}${cmdBtn(`quote ${sym}`)}</div>
    <p class="note">${env ? "Rupiah, semua papan, dari broker summary IPOT." : "Dari arsip harian net asing 100 saham teraktif; bertambah satu sesi per hari."}</p>
    ${envNote(env)}`;
  if (chartReady()) {
    const ch = mkChart($(".chart.sm", body), big);
    const bars = ch.addHistogramSeries({ priceLineVisible: false, priceFormat: { type: "custom", formatter: big } });
    bars.setData(days.map((d) => ({ time: d.date, value: d.net || 0, color: (d.net || 0) >= 0 ? css("--up") : css("--down") })));
    const line = ch.addLineSeries({ color: "#2f6fde", lineWidth: 2, priceScaleId: "left", priceLineVisible: false, priceFormat: { type: "custom", formatter: big } });
    ch.priceScale("left").applyOptions({ visible: true, borderVisible: false });
    line.setData(days.map((d) => ({ time: d.date, value: d.cum })));
    ch.timeScale().fitContent();
  }
}, ["fr"]);

/* market_foreign.json bisa dari IPOT (rupiah, 100 saham teraktif) atau idx.co.id (lembar, semua saham) */
async function marketForeignEnv() {
  const env = await getJSON("flow/market_foreign.json", true);
  if (!env || env._norm) return env;
  env._shares = env.schema === "idx.market.foreign.v1";
  for (const r of [...(env.data.net_buy || []), ...(env.data.net_sell || [])]) {
    r.price ??= r.close;
    r.foreign_net_value ??= r.foreign_net_value_at_close;
    if (r.foreign_net_pct == null && isNum(r.foreign_net_value) && r.value) r.foreign_net_pct = (r.foreign_net_value / r.value) * 100;
  }
  env._norm = true;
  return env;
}

async function marketForeign(a) {
  const env = await marketForeignEnv();
  if (!env) return flowMissing("Data foreign pasar");
  const d = env.data, top = Number(a.flags.top) || 20, sh = env._shares;
  const cols = [
    { h: "Kode", f: (r) => symLink(r.symbol) },
    { h: "Harga", n: 1, f: (r) => nf(r.price) },
    { h: "Chg", n: 1, f: (r) => pct(r.change_pct) },
    { h: sh ? "Net × close" : "Foreign net", n: 1, f: (r) => sgn(r.foreign_net_value) },
    ...(sh ? [{ h: "Net lembar", n: 1, f: (r) => sgn(r.foreign_net) }] : []),
    { h: "% nilai", n: 1, f: (r) => pct(r.foreign_net_pct, 1) },
    { h: "Nilai", n: 1, f: (r) => big(r.value) },
  ];
  const m = d.market;
  const shareCards = sh ? `<div class="cards">${card("Asing beli (lembar)", big(d.foreign_buy))}${card("Asing jual (lembar)", big(d.foreign_sell))}${card("Net (lembar)", sgn(d.foreign_net))}${card("Net × close", sgn(d.foreign_net_value_at_close))}</div>` : "";
  return `
    ${m ? `<div class="cards">${card("Nilai pasar", big(m.value))}${card("Asing beli", big(m.foreign_buy_value))}${card("Asing jual", big(m.foreign_sell_value))}${card("Asing net", sgn(m.foreign_net_value))}</div>` : ""}
    ${shareCards}
    <p class="muted">Sesi ${esc(d.date)} · ${sh ? `${nf(d.stocks)} saham` : `${nf(d.checked)} dari ${nf(d.scanned)} saham teraktif`}</p>
    <div class="grid"><div><h3>Net beli asing</h3>${table(cols, (d.net_buy || []).slice(0, top))}</div><div><h3>Net jual asing</h3>${table(cols, (d.net_sell || []).slice(0, top))}</div></div>
    <p class="note">${sh
      ? "Dari idx.co.id, semua saham, papan reguler. BEI menerbitkan transaksi asing dalam lembar; Net × close adalah net lembar dikali harga penutupan, skala rupiah untuk membandingkan saham, bukan nilai yang benar-benar ditransaksikan asing. % nilai adalah perkiraan dari angka itu."
      : `Rupiah, semua papan, dari broker summary IPOT${d.rounded ? "; angka besar dibulatkan sumbernya" : ""}. Bukan seluruh bursa, hanya 100 saham paling aktif.`}</p>
    ${envNote(env)}`;
}

def("brokers", "brokers [--sort value|net|frequency]", "Ranking broker seluruh pasar sesi terakhir, dengan jenis dan net.", async (a) => {
  const env = await getJSON("flow/market_brokers.json", true);
  if (!env) return flowMissing("Ranking broker");
  const d = env.data, key = a.flags.sort || "value", top = Number(a.flags.top) || 30;
  const getters = { value: (b) => b.value, volume: (b) => b.volume, frequency: (b) => b.frequency, net: (b) => b.net_value, buy: (b) => b.buy_value, sell: (b) => b.sell_value };
  need(getters[key], `Urutan "${key}" tidak dikenal. Pilihan: ${Object.keys(getters).join(", ")}.`);
  const rows = sortRows(d.brokers || [], getters[key], !!a.flags.asc).slice(0, top);
  return `
    <p class="muted">Sesi ${esc(d.date)} · ${nf(d.members)} anggota bursa · nilai ${big(d.total_value)} (beli + jual)</p>
    ${table([{ h: "#", n: 1, f: (_, i) => i + 1 }, { h: "Kode", f: codeLink }, { h: "Nama", f: (b) => esc(b.name || "") }, { h: "Jenis", f: (b) => kind(b.kind) },
             { h: "Nilai", n: 1, f: (b) => big(b.value) }, { h: "Porsi", n: 1, f: (b) => (isNum(b.value_share_pct) ? nf(b.value_share_pct, 2) + "%" : "–") },
             { h: "Beli", n: 1, f: (b) => big(b.buy_value) }, { h: "Jual", n: 1, f: (b) => big(b.sell_value) }, { h: "Net", n: 1, f: (b) => sgn(b.net_value) },
             { h: "Frek", n: 1, f: (b) => big(b.frequency) }], rows)}
    <div class="btns">${["value", "net", "frequency"].map((k) => cmdBtn(`brokers --sort ${k}`, `urut ${k}`)).join("")}${cmdBtn("brokers --sort net --asc", "net jual terbesar")}</div>
    ${env.provider === "idx" ? `<p class="note">Dari idx.co.id: jenis broker serta nilai beli, jual dan net hanya diterbitkan IPOT, jadi kolom itu kosong.</p>` : ""}
    ${envNote(env)}`;
});

/* bandarmology */
const BKEYS = {
  acc: (r) => r.net_pct, net: (r) => r.net_value, lots: (r) => r.net_lots, fnet: (r) => r.foreign_net_value, fpct: (r) => r.foreign_net_pct,
  gain: (r) => r.bandar_gain_pct, chg: (r) => r.price_change_pct, turnover: (r) => r.total_value, conc: (r) => r.buy_share_pct,
  price: (r) => r.price, signal: (r) => r.signal, phase: (r) => r.phase,
};
const PRESETS = {
  "big-accumulation": ["acc>=15"], accumulation: ["acc>=5"], distribution: ["acc<=-5", true], "big-distribution": ["acc<=-15", true],
  "quiet-accumulation": ["phase=quiet_accumulation"], "quiet-distribution": ["phase=quiet_distribution", true],
  "foreign-accumulation": ["acc>=5,fpct>=5"], "below-bandar": ["acc>=5,gain<0"],
};
const label = (s) => esc(String(s || "–").replace(/_/g, " "));
const sigCls = (s) => (/accum|markup/.test(s || "") ? "up" : /distrib|markdown/.test(s || "") ? "down" : "");
const bandarCols = [
  { h: "Kode", f: (r) => symLink(r.symbol) },
  { h: "Sinyal", f: (r) => `<span class="${sigCls(r.signal)}">${label(r.signal)}</span>` },
  { h: "Fase", f: (r) => `<span class="${sigCls(r.phase)}">${label(r.phase)}</span>` },
  { h: "Acc %", n: 1, t: "Net top-N sebagai % nilai transaksi", f: (r) => pct(r.net_pct, 1) },
  { h: "Net", n: 1, f: (r) => sgn(r.net_value) },
  { h: "Harga", n: 1, f: (r) => nf(r.price) },
  { h: "Chg", n: 1, f: (r) => pct(r.price_change_pct) },
  { h: "Avg bandar", n: 1, f: (r) => nf(r.bandar_average) },
  { h: "Gain", n: 1, t: "Harga vs rata-rata beli top-N", f: (r) => pct(r.bandar_gain_pct, 1) },
  { h: "Foreign net", n: 1, f: (r) => sgn(r.foreign_net_value) },
  { h: "Nilai", n: 1, f: (r) => big(r.total_value) },
  { h: "Top beli", f: (r) => (r.top_buyers || []).slice(0, 3).map((c) => `<a class="code" data-cmd="bandar broker ${esc(c)}">${esc(c)}</a>`).join(" ") },
  { h: "Top jual", f: (r) => (r.top_sellers || []).slice(0, 3).map((c) => `<a class="code" data-cmd="bandar broker ${esc(c)}">${esc(c)}</a>`).join(" ") },
];
const periodOf = (a) => { const p = String(a.flags.period || "1w").toLowerCase(); need(p === "1d" || p === "1w", "Periode yang tersedia: 1d atau 1w."); return p; };

def("bandar", "bandar BBCA", "Bandarmology: akumulasi/distribusi broker teratas (1 hari dan 1 minggu).", async (a, body) => {
  const sub = (a.pos[0] || "").toLowerCase();
  if (sub === "screen") return bandarScreenCmd({ pos: a.pos.slice(1), flags: a.flags });
  if (sub === "broker") return bandarBroker({ pos: a.pos.slice(1), flags: a.flags });
  const sym = symArg(a);
  const [d1, w1] = await Promise.all([bandarScreen("1d"), bandarScreen("1w")]);
  if (!d1 && !w1) return flowMissing("Data bandarmology");
  const rows = [["1 hari", d1], ["1 minggu", w1]].map(([p, env]) => {
    const r = env?.data?.rows?.find((x) => x.symbol === sym);
    return r ? { ...r, p, range: `${env.data.from} – ${env.data.to}` } : null;
  }).filter(Boolean);
  if (!rows.length) return `<p class="muted">${esc(sym)} tidak termasuk 100 saham paling aktif di scan terakhir, jadi tidak ada pembacaan bandar.</p>${cmdBtn(`broker ${sym}`)}`;
  return `
    ${table([{ h: "Periode", f: (r) => `${r.p}<br><span class="muted">${esc(r.range)}</span>` }, ...bandarCols.slice(1)], rows)}
    <div class="btns rel">${cmdBtn(`broker ${sym}`)}${cmdBtn(`foreign ${sym}`)}${cmdBtn("bandar screen --preset quiet-accumulation")}</div>
    <p class="note">Net top-5 pembeli dikurangi top-5 penjual sebagai persen nilai transaksi: ≥ +15% big accumulation, +5…+15% accumulation, ±5% netral, dan sebaliknya untuk distribusi. Quiet accumulation = akumulasi saat harga belum naik. Ini heuristik dari 10 broker teratas IPOT, bukan saran investasi.</p>
    ${envNote(d1 || w1)}`;
});

async function bandarScreenCmd(a) {
  const period = periodOf(a);
  const env = await bandarScreen(period);
  if (!env) return flowMissing("Scan bandar");
  const presetName = a.flags.preset || a.pos[0];
  const preset = presetName ? PRESETS[String(presetName).toLowerCase()] : null;
  need(!presetName || preset, `Preset "${presetName}" tidak dikenal. Pilihan: ${Object.keys(PRESETS).join(", ")}.`);
  const filter = compileFilter([preset?.[0], a.flags.filter].filter(Boolean).join(","), BKEYS);
  const sortKey = a.flags.sort || "acc";
  need(BKEYS[sortKey], `Kunci urut "${sortKey}" tidak dikenal.`);
  const asc = a.flags.asc ? true : a.flags.desc ? false : !!preset?.[1];
  const all = (env.data.rows || []).filter(filter);
  const limit = Number(a.flags.limit) || 50;
  const rows = sortRows(all, BKEYS[sortKey], asc).slice(0, limit);
  return `
    <p class="muted">Periode ${esc(env.data.from)} – ${esc(env.data.to)} · ${nf(all.length)} cocok dari ${nf(env.data.checked)} saham</p>
    ${table(bandarCols, rows)}
    <div class="btns rel">${Object.keys(PRESETS).map((p) => cmdBtn(`bandar screen --preset ${p} --period ${period}`, p)).join("")}${cmdBtn(`bandar screen --period ${period === "1w" ? "1d" : "1w"}`, `periode ${period === "1w" ? "1d" : "1w"}`)}</div>
    <p class="note">Filter: acc, net, lots, fnet, fpct, gain, chg, turnover, conc, price, signal=, phase=. Contoh: <a class="code" data-cmd="bandar screen -f acc>=5,fpct>0,gain<0">bandar screen -f acc>=5,fpct>0,gain<0</a></p>
    ${envNote(env)}`;
}

async function bandarBroker(a) {
  need(a.pos[0], "Butuh kode broker, misalnya: bandar broker YP");
  const code = a.pos[0].toUpperCase();
  const scan = await bandarScreen("1d");
  if (!scan) return flowMissing("Data broker per saham");
  const syms = (scan.data.rows || []).map((r) => r.symbol);
  const envs = await Promise.all(syms.map((s) => brokerOf(s)));
  const bought = [], sold = [];
  let info = null;
  for (const env of envs) {
    if (!env) continue;
    const d = env.data;
    const b = (d.buyers || []).find((x) => x.code === code), s = (d.sellers || []).find((x) => x.code === code);
    info = info || b || s;
    const share = (x) => (d.total_value ? (x.value / d.total_value) * 100 : null);
    const net = b && s ? b.value - s.value : null;
    if (b) bought.push({ symbol: d.symbol, ...b, share: share(b), net });
    if (s) sold.push({ symbol: d.symbol, ...s, share: share(s), net });
  }
  const mb = (await getJSON("flow/market_brokers.json", true))?.data?.brokers?.find((x) => x.code === code);
  const cols = [
    { h: "Kode", f: (r) => symLink(r.symbol) }, { h: "Rank", n: 1, k: "rank" }, { h: "Lot", n: 1, f: (r) => big(r.lots) }, { h: "Nilai", n: 1, f: (r) => big(r.value) },
    { h: "Rata2", n: 1, f: (r) => nf(r.average_price) }, { h: "% nilai saham", n: 1, f: (r) => (isNum(r.share) ? nf(r.share, 1) + "%" : "–") }, { h: "Net", n: 1, f: (r) => sgn(r.net) },
  ];
  const sumv = (l) => l.reduce((s, x) => s + (x.value || 0), 0);
  return `
    <p><b class="mono">${esc(code)}</b> ${esc(mb?.name || info?.name || "")} ${kind(mb?.kind || info?.kind)}</p>
    ${kv([["Sesi", esc(scan.data.to)], ["Beli (top-10)", big(sumv(bought))], ["Jual (top-10)", big(sumv(sold))], ["Net seluruh pasar", sgn(mb?.net_value)], ["Nilai seluruh pasar", big(mb?.value)]])}
    <div class="grid"><div><h3>Masuk top-10 pembeli</h3>${table(cols, sortRows(bought, (r) => r.value, false))}</div><div><h3>Masuk top-10 penjual</h3>${table(cols, sortRows(sold, (r) => r.value, false))}</div></div>
    <p class="note">Dari broker summary ${nf(envs.filter(Boolean).length)} saham teraktif. Broker yang tidak masuk 10 besar di sebuah saham tidak terlihat.</p>`;
}

/* screener harga + fundamental */
const SKEYS = {
  price: (r) => r.price, chg: (r) => r.change_pct, volume: (r) => r.volume, value: (r) => r.value, rsi: (r) => r.rsi14,
  sma20: (r) => r.sma20, sma50: (r) => r.sma50, pe: (r) => r.f?.pe, pb: (r) => r.f?.pb, div: (r) => r.f?.div_yield,
  roe: (r) => r.f?.roe, mcap: (r) => r.f?.mcap, revyoy: (r) => r.f?.rev_yoy, niyoy: (r) => r.f?.ni_yoy,
  hsc: (r) => (HSC_SET.has(r.symbol) ? 1 : 0),
};
def("screen", "screen rsi<30,value>1B", "Saring semua saham. Kunci: price, chg, volume, value, rsi, sma20, sma50, pe, pb, div, roe, mcap, revyoy, niyoy, hsc (1/0).", async (a) => {
  const text = [a.pos.join(","), a.flags.filter].filter((x) => x && x !== true).join(",");
  need(text, "Contoh: screen rsi<30,value>1B atau screen price>sma20,sma20>sma50 --sort value");
  const [s, f] = await Promise.all([summary(), fundIndex()]);
  const sortKey = a.flags.sort || "value";
  need(SKEYS[sortKey], `Kunci urut "${sortKey}" tidak dikenal.`);
  const all = s.stocks.map((x) => ({ ...x, f: f[x.symbol] })).filter(compileFilter(text, SKEYS));
  const rows = sortRows(all, SKEYS[sortKey], !!a.flags.asc).slice(0, Number(a.flags.limit) || 50);
  return `
    <p class="muted">${nf(all.length)} cocok dari ${nf(s.stocks.length)} saham · urut ${esc(sortKey)}</p>
    ${table([{ h: "Kode", f: (r) => symLink(r.symbol) }, { h: "Harga", n: 1, f: (r) => nf(r.price) }, { h: "Chg", n: 1, f: (r) => pct(r.change_pct) },
             { h: "Nilai", n: 1, f: (r) => big(r.value) }, { h: "RSI", n: 1, f: (r) => nf(r.rsi14, 1) }, { h: "SMA20", n: 1, f: (r) => nf(r.sma20) }, { h: "SMA50", n: 1, f: (r) => nf(r.sma50) },
             { h: "P/E", n: 1, f: (r) => nf(r.f?.pe, 1) }, { h: "P/B", n: 1, f: (r) => nf(r.f?.pb, 2) }, { h: "Div", n: 1, f: (r) => (isNum(r.f?.div_yield) ? nf(r.f.div_yield, 2) + "%" : "–") },
             { h: "Mkt cap", n: 1, f: (r) => big(r.f?.mcap) }], rows)}
    <div class="btns rel">${cmdBtn("screen rsi<30,value>1B", "oversold likuid")}${cmdBtn("screen price>sma20,sma20>sma50,value>5B", "uptrend")}${cmdBtn("screen chg>5,value>1B --sort chg", "naik kuat")}${cmdBtn("screen pe<10,pe>0,roe>15 --sort roe", "murah & ROE tinggi")}${cmdBtn("screen div>5,mcap>10T --sort div", "dividen tinggi")}</div>
    <p class="note">Kunci di sisi kanan boleh nama kunci lain (price&gt;sma20). P/E, P/B, dividen, ROE dan mcap hanya ada untuk saham yang fundamentalnya sudah diambil.</p>`;
});

/* pasar */
async function macroCards() {
  const m = await getJSON("data.json", true);
  const manual = (await getJSON("manual.json", true)) || {};
  if (!m) return "";
  const defs = [["usdidr", "USD/IDR", 0, ""], ["ihsg", "IHSG", 2, ""], ["crude_oil", "WTI", 2, ""], ["cds_5y", "CDS 5Y", 1, " bps"], ["bond_1y", "Yield 1Y", 2, "%"], ["bond_5y", "Yield 5Y", 2, "%"]];
  return `<div class="cards">${defs.map(([k, l, d, u]) => {
    let x = m[k], note = "";
    if (!x || x.value == null) { x = manual[k]; note = x?.value != null ? `manual ${esc(x.date || "")}` : "tidak tersedia"; }
    if (!x || x.value == null) return card(l, "–", note);
    return card(l, nf(x.value, d) + u, isNum(x.change_pct) ? pct(x.change_pct) : note || esc(x.date || ""));
  }).join("")}</div><p class="note">Makro diperbarui ${wib(m.last_updated)}</p>`;
}
def("macro", "macro", "USD/IDR, IHSG, minyak WTI, CDS dan yield obligasi.", macroCards);

def("market", "market", "Ringkasan pasar: makro, breadth, top gainer/loser/teraktif, asing dan broker.", async () => {
  const s = await summary();
  const last = s.stocks.reduce((m, x) => (x.date > m ? x.date : m), "");
  const today = s.stocks.filter((x) => x.date === last);
  const up = today.filter((x) => x.change_pct > 0).length, down = today.filter((x) => x.change_pct < 0).length;
  const liquid = today.filter((x) => (x.value || 0) >= 1e9);
  const mini = (rows, f) => table([{ h: "Kode", f: (r) => symLink(r.symbol) }, { h: "Harga", n: 1, f: (r) => nf(r.price) }, { h: "Chg", n: 1, f: (r) => pct(r.change_pct) }, { h: f[0], n: 1, f: f[1] }], rows);
  const [mf, mb] = await Promise.all([marketForeignEnv(), getJSON("flow/market_brokers.json", true)]);
  const fcols = [{ h: "Kode", f: (r) => symLink(r.symbol) }, { h: "Chg", n: 1, f: (r) => pct(r.change_pct) }, { h: "Foreign net", n: 1, f: (r) => sgn(r.foreign_net_value) }];
  return `
    ${await macroCards()}
    <div class="cards" style="margin-top:8px">${card("Naik", `<span class="up">${nf(up)}</span>`)}${card("Turun", `<span class="down">${nf(down)}</span>`)}${card("Tetap", nf(today.length - up - down))}${card("Nilai transaksi", big(today.reduce((t, x) => t + (x.value || 0), 0)))}</div>
    <p class="muted">Sesi ${esc(last)} · gainer/loser hanya saham dengan nilai transaksi ≥ 1B</p>
    <div class="grid">
      <div><h3>Top gainer</h3>${mini(sortRows(liquid, (x) => x.change_pct, false).slice(0, 10), ["Nilai", (r) => big(r.value)])}</div>
      <div><h3>Top loser</h3>${mini(sortRows(liquid, (x) => x.change_pct, true).slice(0, 10), ["Nilai", (r) => big(r.value)])}</div>
      <div><h3>Teraktif (nilai)</h3>${mini(sortRows(today, (x) => x.value, false).slice(0, 10), ["Nilai", (r) => big(r.value)])}</div>
      ${mf ? `<div><h3>Net beli asing · ${esc(mf.data.date)}</h3>${table(fcols, (mf.data.net_buy || []).slice(0, 10))}</div>
              <div><h3>Net jual asing</h3>${table(fcols, (mf.data.net_sell || []).slice(0, 10))}</div>` : ""}
      ${mb ? `<div><h3>Top broker · ${esc(mb.data.date)}</h3>${table([{ h: "Kode", f: codeLink }, { h: "Jenis", f: (b) => kind(b.kind) }, { h: "Nilai", n: 1, f: (b) => big(b.value) }, { h: "Net", n: 1, f: (b) => sgn(b.net_value) }], sortRows(mb.data.brokers || [], (b) => b.value, false).slice(0, 10))}</div>` : ""}
    </div>
    ${!mf || !mb ? `<div class="empty" style="margin-top:12px"><b>Data ${!mf && !mb ? "foreign dan broker" : !mf ? "foreign" : "broker"} belum tersedia.</b><p>${flowProblem() || "Diambil setiap hari bursa pukul 19:30 WIB."}</p></div>` : ""}
    <div class="btns rel">${cmdBtn("foreign")}${cmdBtn("brokers")}${cmdBtn("bandar screen")}${cmdBtn("screen rsi<30,value>1B")}</div>`;
});

def("hsc", "hsc [--new] [--sort pct|value|chg]", "Daftar saham Kepemilikan Saham Terkonsentrasi Tinggi (HSC) dari pengumuman BEI terakhir.", async (a) => {
  need(HSC?.codes?.length, "Daftar HSC belum tersedia (file data/hsc.json kosong).");
  const s = await summary();
  const by = Object.fromEntries(s.stocks.map((x) => [x.symbol, x]));
  let rows = HSC.codes.map((c) => ({ symbol: c, ...(by[c] || {}), d: hscDetail(c) }));
  if (a.flags.new) rows = rows.filter((r) => r.d?.new);
  const getters = { pct: (r) => r.d?.pct, value: (r) => r.value, chg: (r) => r.change_pct };
  const key = a.flags.sort || "value";
  need(getters[key], `Urutan "${key}" tidak dikenal. Pilihan: pct, value, chg.`);
  rows = sortRows(rows, getters[key], !!a.flags.asc);
  const nNew = HSC.codes.filter((c) => hscDetail(c)?.new).length;
  const marks = Object.entries(HSC.marks || {}).map(([m, t]) => `<b>${esc(m)}</b> ${esc(t)}`).join("<br>");
  return `
    <div class="flag" role="note"><b>⚑ ${nf(HSC.codes.length)} saham HSC</b>${HSC.details ? ` · ${nf(nNew)} baru` : ""}${HSC.evaluated ? ` · evaluasi per ${tgl(HSC.evaluated)}` : ""}${HSC.effective ? ` · keluar dari IHSG mulai ${tgl(HSC.effective)}` : ""}
      <br><span class="muted">${hscSrc()}</span>${HSC.note ? `<br>${esc(HSC.note)}` : ""}</div>
    <p class="muted">${a.flags.new ? `${nf(rows.length)} saham baru` : `${nf(rows.length)} saham`} · urut ${esc(key)}</p>
    ${table([{ h: "Kode", f: (r) => symLink(r.symbol) }, { h: "Top-10 %", n: 1, t: "Kepemilikan 10 pemegang terbesar", f: (r) => nf(r.d?.pct, 2) },
             { h: "Status", f: (r) => (r.d ? (r.d.new ? "baru" : "lanjutan") : "–") }, { h: "Catatan", f: (r) => (r.d?.mark ? `<span class="down" title="${esc(HSC.marks?.[r.d.mark] || "")}">${esc(r.d.mark)}</span>` : "") },
             { h: "Harga", n: 1, f: (r) => nf(r.price) }, { h: "Chg", n: 1, f: (r) => pct(r.change_pct) },
             { h: "Nilai", n: 1, f: (r) => big(r.value) }, { h: "RSI", n: 1, f: (r) => nf(r.rsi14, 1) }], rows)}
    <div class="btns">${cmdBtn("hsc --new", "hanya yang baru")}${cmdBtn("hsc --sort pct", "urut konsentrasi")}${cmdBtn("screen hsc=0,rsi<30,value>1B", "screen tanpa HSC")}</div>
    ${marks ? `<p class="note">${marks}</p>` : ""}
    <p class="note">Diperbarui manual dari PDF pengumuman BEI/KSEI (scripts/hsc_update.py). Masuk daftar HSC tidak berarti ada pelanggaran; cocokkan dengan menu Kepemilikan Saham Terkonsentrasi Tinggi di idx.co.id.</p>`;
});

def("history", "history", "Perintah yang pernah dijalankan di peramban ini.", async () => {
  const h = loadHist();
  return h.length ? `<div class="btns">${h.slice().reverse().map((c) => cmdBtn(c)).join("")}</div>` : `<p class="muted">Belum ada riwayat.</p>`;
});
def("clear", "clear", "Kosongkan semua panel hasil.", async (a, body, sec) => {
  document.querySelectorAll("#results .panel").forEach((p) => p !== sec && p.remove());
  return `<p class="muted">Panel dibersihkan.</p>`;
}, ["cls"]);

COMMANDS.quote.example = "BBCA";
COMMANDS.foreign.example = "foreign";
COMMANDS.brokers.example = "brokers";
COMMANDS.bandar.example = "bandar BBCA";
def("bandar screen", "bandar screen [--preset P] [--period 1d|1w] [-f FILTER]", "Saring 100 saham teraktif menurut sinyal bandar. Preset: big-accumulation, accumulation, distribution, quiet-accumulation, foreign-accumulation, below-bandar, …", async (a) => bandarScreenCmd(a));
def("bandar broker", "bandar broker YP", "Saham-saham tempat satu broker masuk 10 pembeli/penjual teratas.", async (a) => bandarBroker(a));
COMMANDS["bandar screen"].example = "bandar screen --preset accumulation";

/* ---------- perutean perintah ---------- */
function resolve(tokens) {
  const two = tokens.slice(0, 2).join(" ").toLowerCase();
  const first = (tokens[0] || "").toLowerCase();
  if (first === "bandar" && /^(screen|broker)$/i.test(tokens[1] || "")) return [COMMANDS[two], tokens.slice(2)];
  if (COMMANDS[first]) return [COMMANDS[first], tokens.slice(1)];
  if (/^[a-z0-9]{4}(\.jk)?$/i.test(first)) return [COMMANDS.quote, tokens];
  return [null, tokens];
}
const FLAG_CMDS = () => new Set(["quote", "technical", "fundamental", "broker", "foreign", "bandar"].map((n) => COMMANDS[n]));
/* riwayat */
const HKEY = "idx-lite-history";
const loadHist = () => { try { return JSON.parse(localStorage.getItem(HKEY) || "[]"); } catch (e) { return []; } };
function pushHist(line) {
  const h = loadHist().filter((x) => x !== line);
  h.push(line);
  try { localStorage.setItem(HKEY, JSON.stringify(h.slice(-50))); } catch (e) { /* abaikan */ }
}


/* ---------- status data ---------- */
async function freshness() {
  const [s, m, f] = await Promise.all([getJSON("summary.json", true), getJSON("flow/meta.json", true), getJSON("fundamentals.json", true)]);
  const parts = [];
  if (s) parts.push(`harga ${wib(s.updated)}`);
  if (m) parts.push(`foreign & broker ${wib(m.updated)}`);
  if (f) parts.push(`fundamental ${wib(f.updated)}`);
  const el = $("#fresh");
  if (el) el.textContent = parts.length ? "Diperbarui: " + parts.join(" · ") : "Data belum tersedia.";
}
