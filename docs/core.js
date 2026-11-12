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
    ${d?.analyst ? `<h3>Target analis</h3>${kv([["Rekomendasi", recWord(d.analyst.recommendation)], ["Analis", nf(d.analyst.analysts)], ["Target rata-rata", nf(d.analyst.target_mean)], ["Rentang", isNum(d.analyst.target_low) ? `${nf(d.analyst.target_low)} – ${nf(d.analyst.target_high)}` : "–"]])}<div class="btns">${cmdBtn(`analyst ${sym}`, "detail analis & riwayat per sekuritas")}</div>` : ""}
    <h3>Kuartalan</h3>${tbl(d?.quarters, false)}
    <h3>Tahunan</h3>${tbl(d?.annual, true)}
    <p class="note">Sumber Yahoo Finance, mata uang laporan ${esc(d?.currency || "?")}. Kuartal yang tidak tersedia tampil kosong. Cocokkan dengan laporan resmi.</p>`;
}, ["fund", "f"]);

/* ---------- target harga analis ---------- */
const REC = { strong_buy: ["Beli kuat", "up"], buy: ["Beli", "up"], hold: ["Tahan", ""], underperform: ["Di bawah pasar", "down"], sell: ["Jual", "down"], strong_sell: ["Jual kuat", "down"] };
const UD_ACTION = { up: "naik peringkat", down: "turun peringkat", main: "pertahankan", init: "mulai meliput", reit: "tegaskan ulang" };
const TGT_ACTION = { Raises: ["naik", "up"], Lowers: ["turun", "down"], Maintains: ["tetap", ""], Announces: ["baru", ""] };
const PERIOD = { "0m": "Bulan ini", "-1m": "1 bulan lalu", "-2m": "2 bulan lalu", "-3m": "3 bulan lalu" };
const recWord = (k) => (k && REC[k] ? `<b class="${REC[k][1]}">${REC[k][0]}</b>` : k && k !== "none" ? esc(k) : "–");

/* Data analis: dari fundamentals/KODE.json (Yahoo, lengkap) atau, kalau belum ada, dari brief (ringkas). */
async function analystOf(sym) {
  const d = await getJSON(`fundamentals/${sym}.json`, true);
  if (d?.analyst) return { a: d.analyst, src: `Yahoo Finance, diambil ${tgl(d.fetched)}` };
  const b = await getJSON(`brief/${sym}.json`, true);
  const x = b?.data?.fundamentals?.analyst;
  if (x && (x.target_mean != null || x.recommendation)) {
    return { a: { recommendation: x.recommendation, analysts: x.analysts, target_mean: x.target_mean, target_high: x.target_high, target_low: x.target_low, trend: [], history: [] },
             src: `idx stocks brief, ${wib(b.fetched_at)}` };
  }
  return null;
}
const upside = (target, price) => (isNum(target) && isNum(price) && price ? (target / price - 1) * 100 : null);

function analystHtml(a, price, src) {
  const up = upside(a.target_mean, price);
  const lo = a.target_low, hi = a.target_high;
  let bar = "";
  if (isNum(lo) && isNum(hi) && hi > lo) {
    const min = Math.min(lo, price), max = Math.max(hi, price), pos = (v) => ((v - min) / (max - min)) * 100;
    bar = `<div class="tbar" aria-hidden="true"><div class="tbar-range" style="left:${pos(lo)}%;width:${pos(hi) - pos(lo)}%"></div>
      ${isNum(a.target_mean) ? `<div class="tbar-mean" style="left:${pos(a.target_mean)}%" title="Target rata-rata"></div>` : ""}
      <div class="tbar-px" style="left:${pos(price)}%" title="Harga sekarang"></div></div>
      <div class="tbar-legend"><span>Terendah ${nf(lo)}</span><span>■ harga sekarang ${nf(price)} · ┃ target rata-rata</span><span>Tertinggi ${nf(hi)}</span></div>`;
  }
  const trend = (a.trend || []).filter((r) => PERIOD[r.period] !== undefined);
  const hist = a.history || [];
  return `
    ${kv([["Rekomendasi", recWord(a.recommendation)], ["Jumlah analis", nf(a.analysts)], ["Target rata-rata", nf(a.target_mean)],
          ["Potensi dari harga", pct(up, 1)], ["Target median", nf(a.target_median)], ["Target tertinggi", nf(hi)], ["Target terendah", nf(lo)]])}
    ${bar}
    ${trend.length ? `<h3>Sebaran rekomendasi</h3>${table([{ h: "Periode", f: (r) => PERIOD[r.period] }, { h: "Beli kuat", n: 1, k: "strongBuy" }, { h: "Beli", n: 1, k: "buy" },
        { h: "Tahan", n: 1, k: "hold" }, { h: "Jual", n: 1, k: "sell" }, { h: "Jual kuat", n: 1, k: "strongSell" }], trend)}` : ""}
    <h3>Riwayat per sekuritas</h3>
    ${hist.length ? table([{ h: "Tanggal terbit", f: (r) => tgl(r.date) }, { h: "Sekuritas / analis", f: (r) => esc(r.firm || "–") },
        { h: "Rekomendasi", f: (r) => (r.from && r.from !== r.to ? `${esc(r.from)} → ` : "") + `<b>${esc(r.to || "–")}</b>` },
        { h: "Aksi", f: (r) => esc(UD_ACTION[r.action] || r.action || "–") },
        { h: "Target", n: 1, f: (r) => (isNum(r.target) ? (isNum(r.prior_target) && r.prior_target !== r.target ? `${nf(r.prior_target)} → ` : "") + `<b>${nf(r.target)}</b>` : "–") },
        { h: "", f: (r) => (r.target_action && TGT_ACTION[r.target_action] ? `<span class="${TGT_ACTION[r.target_action][1]}">${TGT_ACTION[r.target_action][0]}</span>` : "") }], hist)
      : `<div class="empty"><p>Sumber tidak mencantumkan nama sekuritas atau tanggal terbit untuk saham ini. Yang tersedia hanya ringkasan target di atas.</p></div>`}
    <p class="note">Sumber: ${esc(src)}. Target dan rekomendasi dikumpulkan Yahoo Finance dari sekuritas yang meliput saham ini; cakupan untuk saham Indonesia sering terbatas dan bisa tertinggal dari laporan riset terbaru. Bukan saran investasi.</p>`;
}

def("analyst", "analyst BBCA", "Target harga dan rekomendasi analis: rata-rata, rentang, sebaran, dan riwayat per sekuritas beserta tanggal terbit.", async (a) => {
  const sym = symArg(a);
  const s = await stock(sym);
  const r = await analystOf(sym);
  if (!r) return `<div class="empty"><b>Belum ada data analis untuk ${esc(sym)}.</b><p>Data ini ikut pengambilan fundamental (100 saham per hari, yang paling aktif dulu). Banyak saham kecil memang tidak diliput analis.</p></div>`;
  return analystHtml(r.a, s.price, r.src);
}, ["target", "analis"]);

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
  target: (r) => r.f?.target, upside: (r) => upside(r.f?.target, r.price), analysts: (r) => r.f?.analysts,
};
def("screen", "screen rsi<30,value>1B", "Saring semua saham. Kunci: price, chg, volume, value, rsi, sma20, sma50, pe, pb, div, roe, mcap, revyoy, niyoy, target, upside (% ke target analis), analysts, hsc (1/0).", async (a) => {
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
/* ---------- makro: kartu bertren + halaman grafik ---------- */
const MACRO = [
  { k: "usdidr", l: "USD/IDR", d: 0, u: "", inv: 1 }, { k: "ihsg", l: "IHSG", d: 2, u: "" }, { k: "crude_oil", l: "Minyak WTI", d: 2, u: "" },
  { k: "bond_2y", l: "Yield SBN 2Y", d: 2, u: "%", y: 1, inv: 1 }, { k: "bond_5y", l: "Yield SBN 5Y", d: 2, u: "%", y: 1, inv: 1 }, { k: "bond_10y", l: "Yield SBN 10Y", d: 2, u: "%", y: 1, inv: 1 },
  { k: "cds_5y", l: "CDS 5Y", d: 1, u: " bps", y: 1, inv: 1 },
];
const bpTxt = (v) => (isNum(v) ? `<span class="${v > 0 ? "down" : v < 0 ? "up" : ""}">${v > 0 ? "▲" : v < 0 ? "▼" : ""}${nf(Math.abs(v), 1)}</span>` : "–");
async function macroData() {
  const [m, series, hist, manual] = await Promise.all([getJSON("data.json", true), getJSON("macro_series.json", true), getJSON("macro_hist.json", true), getJSON("manual.json", true)]);
  /* riwayat per indikator: seri Yahoo 1 tahun, disambung arsip harian sendiri */
  const seriesOf = (k) => {
    const map = new Map((series?.[k] || []).map(([d, v]) => [d, v]));
    for (const [d, v] of Object.entries(hist?.[k] || {})) if (!map.has(d)) map.set(d, v);
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  };
  return { m, manual: manual || {}, seriesOf };
}
function spark(rows, invert) {
  const pts = rows.slice(-60);
  if (pts.length < 2) return "";
  const vs = pts.map((r) => r[1]), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const xy = vs.map((v, i) => `${((i / (vs.length - 1)) * 100).toFixed(1)},${(28 - ((v - lo) / span) * 26 - 1).toFixed(1)}`).join(" ");
  const up = vs[vs.length - 1] >= vs[0];
  const good = invert ? !up : up;   // yield/CDS naik = memburuk
  return `<svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="${xy}" class="${good ? "up" : "down"}"/></svg>`;
}
async function macroCards() {
  const { m, manual, seriesOf } = await macroData();
  if (!m) return "";
  return `<div class="cards macro">${MACRO.map((c) => {
    let x = m[c.k], note = "";
    if ((!x || x.value == null) && manual[c.k]?.value != null) { x = manual[c.k]; note = `manual ${esc(x.date || "")}`; }
    if (!x || x.value == null) return `<a class="card" data-cmd="macro"><div class="l">${c.l}</div><div class="v">–</div><div class="s">${c.k === "cds_5y" ? "isi di manual.json" : "tidak tersedia"}</div></a>`;
    const sub = c.y && isNum(x.chg_1d_bp)
      ? `${bpTxt(x.chg_1d_bp)} bp · 1mg ${bpTxt(x.chg_1w_bp)} · YTD ${bpTxt(x.chg_ytd_bp)}`
      : isNum(x.change_pct) ? `<span class="${cls(c.inv ? -x.change_pct : x.change_pct)}">${x.change_pct > 0 ? "+" : ""}${nf(x.change_pct, 2)}%</span>` : note || esc(x.date || "");
    return `<a class="card" data-cmd="macro" title="Lihat grafik"><div class="l">${c.l}</div><div class="v">${nf(x.value, c.d)}${c.u}</div><div class="s">${sub}</div>${spark(seriesOf(c.k), c.inv)}</a>`;
  }).join("")}</div><p class="note">Makro diperbarui ${wib(m.last_updated)} · yield: AsianBondsOnline (ADB), perubahan dalam basis poin · ketuk kartu untuk grafik</p>`;
}
def("macro", "macro", "Indikator makro dengan grafik tren: USD/IDR, IHSG, minyak WTI, yield SBN 2Y/5Y/10Y, CDS 5Y.", async (a, body) => {
  const { m, manual, seriesOf } = await macroData();
  need(m, "Data makro belum tersedia.");
  const charts = MACRO.map((c) => {
    const rows = seriesOf(c.k);
    const x = m[c.k]?.value != null ? m[c.k] : manual[c.k];
    return { ...c, rows, x };
  });
  body.innerHTML = `
    ${await macroCards()}
    <div class="btns" data-mrange>${["1M", "3M", "6M", "1Y", "Semua"].map((k) => `<button class="btn" data-r="${k}" aria-pressed="${k === "3M"}">${k}</button>`).join("")}</div>
    <div class="grid">${charts.map((c) => `
      <div class="mchart"><h3>${c.l}${c.x?.value != null ? ` · ${nf(c.x.value, c.d)}${c.u}` : ""}</h3>
        ${c.rows.length >= 2 ? `<div class="chart sm" data-k="${c.k}"></div>` : `<div class="empty"><p>${c.k === "cds_5y" ? "Belum ada riwayat. CDS diisi manual di docs/data/manual.json; setiap isian tercatat sebagai satu titik." : "Riwayat sedang dikumpulkan, satu titik per hari sejak sumber ini dipasang."}</p></div>`}
        ${c.y && c.rows.length ? `<p class="note">Riwayat sejak ${tgl(c.rows[0][0])} (${c.rows.length} titik).</p>` : ""}
      </div>`).join("")}</div>
    <p class="note">Sumber: Frankfurter (kurs ECB) dan Yahoo Finance untuk USD/IDR, IHSG, WTI; AsianBondsOnline (ADB) untuk yield SBN; CDS 5Y diisi manual karena tidak ada sumber gratis resmi. Warna: untuk USD/IDR (rupiah melemah), yield dan CDS, kenaikan ditandai merah.</p>`;
  if (!chartReady()) return;
  const made = [];
  for (const c of charts) {
    const el = body.querySelector(`.chart[data-k="${c.k}"]`);
    if (!el) continue;
    const ch = mkChart(el, (p) => nf(p, c.d));
    const s = ch.addAreaSeries({ lineWidth: 2, lineColor: "#2f6fde", topColor: "rgba(47,111,222,.25)", bottomColor: "rgba(47,111,222,0)", priceLineVisible: false });
    s.setData(c.rows.map(([time, value]) => ({ time, value })));
    made.push([ch, c.rows]);
  }
  const DAYS = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, Semua: 99999 };
  const setRange = (k) => {
    const from = new Date(Date.now() - DAYS[k] * 864e5).toISOString().slice(0, 10);
    for (const [ch, rows] of made) {
      const f = rows.find((r) => r[0] >= from)?.[0] || rows[0][0];
      ch.timeScale().setVisibleRange({ from: f, to: rows[rows.length - 1][0] });
    }
    body.querySelectorAll("[data-mrange] button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.r === k));
  };
  body.querySelector("[data-mrange]").addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (b) setRange(b.dataset.r); });
  requestAnimationFrame(() => setRange("3M"));
}, ["makro"]);

/* ---------- watchlist saya (disimpan di browser) + time to buy (scripts/build_signals.py) ---------- */
const WKEY = "idxlite.watch";
const watchList = () => { try { return JSON.parse(localStorage.getItem(WKEY) || "[]"); } catch (e) { return []; } };
const watchSave = (xs) => { try { localStorage.setItem(WKEY, JSON.stringify([...new Set(xs)])); } catch (e) { /* mode privat */ } };
const watchHas = (s) => watchList().includes(s);
function watchToggle(s) { const w = watchList(); watchSave(w.includes(s) ? w.filter((x) => x !== s) : [...w, s]); return !w.includes(s); }

const TTB = {
  gabungan: { k: "c", list: "combined", l: "Gabungan", d: "Fundamental sehat dan momentum teknikal sudah masuk. Kandidat paling lengkap." },
  teknikal: { k: "t", list: "technical", l: "Teknikal", d: "Tren, momentum, volume, dan setup masuk (breakout, pullback, rebound). Cocok untuk swing beberapa hari sampai minggu." },
  fundamental: { k: "f", list: "fundamental", l: "Fundamental", d: "Untung, tumbuh, valuasi di bawah sektor, didukung analis/dividen. Cocok untuk koleksi jangka menengah-panjang; waktu masuk tetap lihat teknikal." },
  saya: { k: null, list: null, l: "Watchlist saya", d: "Saham yang kamu tandai ☆ di halaman saham, dengan status ketiga sudut pandang. Tersimpan di browser ini saja." },
};
const ST_LABEL = { beli: "Sinyal beli", pantau: "Pantau" };
const stBadge = (x) => (x?.status ? `<span class="st st-${x.status}">${ST_LABEL[x.status]}</span>` : `<span class="muted">–</span>`);
const scoreBar = (v) => (isNum(v) ? `<span class="score" title="Skor ${v}/100"><span class="trk"><i style="width:${Math.max(4, v)}%"></i></span><b>${v}</b></span>` : "–");
let SIG_SESSION = null;
const sinceTxt = (x) => (!x?.since ? "" : x.since === SIG_SESSION ? `<span class="since muted">baru hari ini</span>`
  : `<span class="since"><span class="muted">sejak ${esc(tgl(x.since))}</span> ${pct(x.since_ret, 1)}</span>`);
const levels = (t) => (t ? `<span class="lv">${nf(t.stop)} <span class="muted">/</span> ${nf(t.target)}</span>` : "–");
const why = (x) => (x ? [...(x.setups || []).map((t) => `<span class="tag bull">${esc(t)}</span>`), ...(x.reasons || []).slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`),
  ...(x.warnings || []).map((t) => `<span class="tag bear">${esc(t)}</span>`)].join("") : "");

def("buy", "buy [gabungan|teknikal|fundamental|saya] [--semua]", "Watchlist time to buy: saham dengan sinyal beli menurut teknikal, fundamental, atau keduanya. --semua menampilkan juga yang berstatus pantau; --tanpa-hsc menyembunyikan saham HSC.", async (a) => {
  const sig = await getJSON("signals.json", true);
  need(sig, "Data sinyal belum ada. Dihitung otomatis setelah workflow harga selesai (sekitar 16:45 WIB).");
  SIG_SESSION = sig.session;
  const mode = TTB[String(a.pos[0] || "gabungan").toLowerCase()] ? String(a.pos[0] || "gabungan").toLowerCase() : "gabungan";
  const m = TTB[mode], all = !!(a.flags.semua || a.flags.all);
  const S = sig.stocks;
  const nohsc = !!a.flags["tanpa-hsc"];
  const cmdOf = (md, al, nh) => `buy ${md}${al ? " --semua" : ""}${nh ? " --tanpa-hsc" : ""}`;
  const tabs = `<div class="seg wrap" role="group" aria-label="Sudut pandang">${Object.entries(TTB).map(([id, x]) =>
    `<button data-cmd="${cmdOf(id, all, nohsc)}" aria-pressed="${id === mode}">${x.l}</button>`).join("")}</div>`;
  const toggle = mode === "saya" ? "" : `<div class="chips">${[[false, "Sinyal beli saja"], [true, "Termasuk pantau"]].map(([v, l]) =>
    `<button class="chip" data-cmd="${cmdOf(mode, v, nohsc)}" aria-pressed="${v === all}">${l}</button>`).join("")}
    <button class="chip" data-cmd="${cmdOf(mode, all, !nohsc)}" aria-pressed="${nohsc}">Sembunyikan HSC</button></div>`;
  const head = `${tabs}${toggle}<p class="muted">${m.d}</p>`;
  const foot = `<details class="rules"><summary>Cara penilaian</summary>
      <p><b>Saham yang dinilai:</b> ${esc(sig.rules.universe)} ${nf(sig.evaluated)} saham dinilai sesi ${esc(tgl(sig.session))}; ${nf(sig.with_fundamental)} punya data fundamental (bertambah 100 saham per hari).</p>
      ${["technical", "fundamental", "combined"].map((k) => `<p><b>${{ technical: "Teknikal", fundamental: "Fundamental", combined: "Gabungan" }[k]}</b></p><ul>${sig.rules[k].map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`).join("")}
      <p><b>Stop / target</b>: stop = yang lebih dekat antara 2× ATR14 di bawah harga dan low 10 hari; target = resistance 60 hari atau 2× risiko. <b>Sejak</b> = tanggal sinyal beli pertama muncul dan hasil sejak itu.</p>
    </details>
    <p class="note">Penyaring berbasis aturan dari data tertunda, bukan saran investasi. Selalu cek berita, laporan keuangan, dan batasi risiko per transaksi. Diperbarui ${wib(sig.updated)}.</p>`;

  const mini = (pairs) => `<div class="tm">${pairs.filter(([, v]) => v != null && v !== "–").map(([k, v]) => `<span><i>${k}</i> ${v}</span>`).join("")}</div>`;
  const techM = (t) => (t ? [["RSI", nf(t.rsi, 0)], ["Stop", nf(t.stop)], ["Target", nf(t.target)], ["R:R", nf(t.rr, 1)], ["Risiko", isNum(t.risk_pct) ? nf(t.risk_pct, 1) + "%" : null]] : []);
  const fundM = (f) => (f && !f.excluded ? [["P/E", `${nf(f.pe, 1)}${isNum(f.med_pe) ? ` <span class="muted">vs ${nf(f.med_pe, 1)}</span>` : ""}`], ["P/B", nf(f.pb, 2)],
    ["ROE", isNum(f.roe) ? nf(f.roe, 1) + "%" : null], ["Laba YoY", isNum(f.ni_yoy) ? pct(f.ni_yoy, 0) : null], ["Ke target", isNum(f.upside) ? pct(f.upside, 0) : null],
    ["Div", isNum(f.div) ? nf(f.div, 1) + "%" : null]] : []);
  const item = (r, x, metrics, tags, extra = "") => `<article class="ti">
      <div class="ti-h"><div>${watchHas(r.symbol) ? "★ " : ""}${symLink(r.symbol)} <span class="ti-px">${nf(r.price)}</span> ${pct(r.chg)}</div>
        <div class="ti-s">${stBadge(x)} ${scoreBar(x && !x.excluded ? x.score : null)}</div></div>
      ${sinceTxt(x)}${extra}${mini(metrics)}<div class="tags">${tags}</div></article>`;

  if (mode === "saya") {
    const w = watchList();
    if (!w.length) return `${head}<div class="empty"><b>Watchlist masih kosong.</b><p>Buka halaman saham lalu ketuk ☆ di samping kodenya.</p></div>${foot}`;
    const cards = w.map((sym) => {
      const r = { symbol: sym, ...(S[sym] || {}) };
      if (!r.t && !r.f) return item(r, null, [], `<span class="muted">Tidak dinilai: saham HSC, kurang likuid, atau riwayat harga belum cukup.</span>`);
      const sub = (l, x) => `<div class="ttb-row"><span class="ttb-l">${l}</span>${stBadge(x)} ${scoreBar(x && !x.excluded ? x.score : null)}</div>`;
      return item(r, r.c, [...techM(r.t), ...fundM(r.f)], why(r.t) + why(r.f), sub("Teknikal", r.t) + sub("Fundamental", r.f));
    }).join("");
    return `${head}<div class="tlist">${cards}</div><div class="btns">${w.map((s) => `<button class="btn" data-unwatch="${esc(s)}">Hapus ${esc(s)}</button>`).join("")}</div>${foot}`;
  }

  const list = sig.lists[m.list].filter((s) => (all || S[s][m.k].status === "beli") && !(nohsc && S[s].hsc));
  const cnt = sig.counts[m.list];
  const intro = `<p><b>${nf(cnt.beli)}</b> sinyal beli${all ? `, ${nf(cnt.total - cnt.beli)} pantau` : ""} dari ${nf(sig.evaluated)} saham likuid.</p>`;
  const cards = list.map((sym) => {
    const r = { symbol: sym, ...S[sym] };
    if (mode === "teknikal") return item(r, r.t, techM(r.t), why(r.t));
    if (mode === "fundamental") return item(r, r.f, fundM(r.f), why(r.f), `<div class="ttb-row"><span class="muted">Teknikal:</span> ${stBadge(r.t)} ${scoreBar(r.t?.score)}</div>`);
    return item(r, r.c, [["Teknikal", nf(r.t.score)], ["Fundamental", nf(r.f.score)], ...techM(r.t).slice(1, 4), ...fundM(r.f).slice(0, 1)],
      why({ setups: r.t.setups, reasons: [...r.f.reasons.slice(0, 2), ...r.t.reasons.slice(0, 1)], warnings: [...r.t.warnings, ...r.f.warnings] }));
  }).join("");
  const empty = `<div class="empty">${all ? "Belum ada saham yang memenuhi syarat." : `Tidak ada sinyal beli hari ini. <a data-cmd="buy ${mode} --semua">Tampilkan yang berstatus pantau</a>.`}</div>`;
  return `${head}${intro}${cards ? `<div class="tlist">${cards}</div>` : empty}${foot}`;
}, ["timetobuy", "beli", "watchlist"]);

/* kartu ringkas time to buy di tab Ringkasan saham */
async function ttbCard(sym) {
  const sig = await getJSON("signals.json", true), e = sig?.stocks?.[sym];
  if (!e) return "";
  SIG_SESSION = sig.session;
  const line = (label, x, extra = "") => `<div class="ttb-row"><span class="ttb-l">${label}</span>${stBadge(x)} ${scoreBar(x && !x.excluded ? x.score : null)} ${sinceTxt(x)}${extra}</div>`;
  return `<div class="ai-card ttb"><div class="ai-head"><b>Time to buy</b><a class="muted" data-cmd="buy">lihat semua</a></div>
    ${line("Gabungan", e.c)}
    ${line("Teknikal", e.t, e.t ? ` <span class="muted">stop ${nf(e.t.stop)} · target ${nf(e.t.target)} · R:R ${nf(e.t.rr, 1)}</span>` : "")}
    ${line("Fundamental", e.f)}
    <div class="tags">${why(e.t)}${why(e.f)}</div>
    <p class="note">Skor 0–100 dari aturan sederhana, sesi ${esc(tgl(sig.session))}. Bukan saran investasi.</p></div>`;
}

/* ---------- laporan AI (scripts/ai_report.py) ---------- */
const AI_KIND = { sesi1: "Sesi 1", full: "Penutupan" };
function aiCard(r, full = false) {
  if (!r) return "";
  const f = r.facts || {}, ih = f.ihsg || {}, b = f.breadth || {};
  const row = (xs, g) => (xs || []).slice(0, 5).map(g).join(" · ") || "–";
  const when = new Date(r.generated_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `<div class="ai-card">
    <div class="ai-head"><b>Laporan ${AI_KIND[r.kind] || esc(r.kind)}</b><span class="muted">${esc(tgl(r.date))} · dibuat ${esc(when)} WIB</span></div>
    ${ih.value ? `<p>IHSG <b>${nf(ih.value, 2)}</b> ${pct(ih.change_pct)} · naik ${nf(b.naik)}, turun ${nf(b.turun)}, tetap ${nf(b.tetap)} <span class="muted">(${nf(b.dipantau)} saham teraktif)</span></p>` : ""}
    ${r.ai_text ? `<p class="ai-text">${esc(r.ai_text)}</p><p class="note">Ditulis AI (${esc(r.model || "")}) hanya dari angka di atas. Bisa keliru; bukan saran investasi.</p>`
                : `<p class="note">Ringkasan AI tidak tersedia untuk laporan ini (key AI belum diisi atau layanan AI gagal).</p>`}
    ${full ? `<p><b>Top gainer:</b> ${row(f.gainers, (m) => `${symLink(m.symbol)} ${pct(m.change_pct)}`)}</p>
      <p><b>Top loser:</b> ${row(f.losers, (m) => `${symLink(m.symbol)} ${pct(m.change_pct)}`)}</p>
      <p><b>Teraktif:</b> ${row(f.active, (m) => `${symLink(m.symbol)} ${big(m.value)}`)}</p>
      ${f.hsc_movers?.length ? `<p><b>Saham HSC bergerak tajam:</b> ${row(f.hsc_movers, (m) => `${symLink(m.symbol)} ${pct(m.change_pct)}`)}</p>` : ""}` : ""}
  </div>`;
}

def("ai", "ai [YYYY-MM-DD-sesi1|YYYY-MM-DD-full]", "Laporan pasar otomatis sesi 1 dan penutupan, dengan ringkasan AI. Tanpa argumen: laporan terbaru dan arsipnya.", async (a) => {
  const idx = await getJSON("ai/index.json", true);
  need(idx?.reports?.length, "Belum ada laporan AI. Laporan dibuat otomatis setelah sesi 1 (12:10 WIB, Jumat 11:40) dan setelah penutupan (17:05 WIB).");
  const id = a[0] || idx.reports[0].id;
  const r = await getJSON(`ai/${id}.json`, true);
  need(r, `Laporan ${id} tidak ditemukan.`);
  const list = idx.reports.slice(0, 30).map((x) => `<a class="code" data-cmd="ai ${esc(x.id)}">${esc(x.date)} ${AI_KIND[x.kind] || x.kind}</a> ${pct(x.ihsg_change_pct)}`).join("<br>");
  return `${aiCard(r, true)}<h3>Arsip laporan</h3><p>${list}</p>`;
}, ["laporan"]);

def("market", "market", "Ringkasan pasar: makro, breadth, top gainer/loser/teraktif, asing dan broker.", async () => {
  const s = await summary();
  const last = s.stocks.reduce((m, x) => (x.date > m ? x.date : m), "");
  const today = s.stocks.filter((x) => x.date === last);
  const up = today.filter((x) => x.change_pct > 0).length, down = today.filter((x) => x.change_pct < 0).length;
  const liquid = today.filter((x) => (x.value || 0) >= 1e9);
  const mini = (rows, f) => table([{ h: "Kode", f: (r) => symLink(r.symbol) }, { h: "Harga", n: 1, f: (r) => nf(r.price) }, { h: "Chg", n: 1, f: (r) => pct(r.change_pct) }, { h: f[0], n: 1, f: f[1] }], rows);
  const [mf, mb] = await Promise.all([marketForeignEnv(), getJSON("flow/market_brokers.json", true)]);
  const fcols = [{ h: "Kode", f: (r) => symLink(r.symbol) }, { h: "Chg", n: 1, f: (r) => pct(r.change_pct) }, { h: "Foreign net", n: 1, f: (r) => sgn(r.foreign_net_value) }];
  const air = await getJSON("ai/latest.json", true);
  const aiFresh = air && air.date >= last ? `${aiCard(air)}<div class="btns">${cmdBtn("ai", "Laporan lengkap & arsip")}</div>` : "";
  return `
    ${await macroCards()}
    ${aiFresh}
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

/* ---------- kepemilikan (KSEI > 1%) ---------- */
const INVESTOR = {
  CORPORATE: "Korporasi", INDIVIDUAL: "Individu", "MUTUAL FUND": "Reksa dana", INSURANCE: "Asuransi", "PENSION FUND": "Dana pensiun",
  "FINANCIAL INSTITUTION": "Lembaga keuangan", "SECURITIES COMPANY": "Perusahaan efek", FOUNDATION: "Yayasan", OTHERS: "Lainnya",
};
const invType = (t) => esc(INVESTOR[String(t || "").toUpperCase()] || (t ? String(t).toLowerCase() : "–"));
const lf = (x) => (x === "A" ? `<span class="k-foreign">Asing</span>` : x === "L" ? `<span class="k-local">Lokal</span>` : "–");
const CHG = { new: ["baru", "up"], exited: ["keluar", "down"] };
const chgKind = (c) => (CHG[c.kind] ? `<span class="${CHG[c.kind][1]}">${CHG[c.kind][0]}</span>` : c.pct_change > 0 ? `<span class="up">naik</span>` : `<span class="down">turun</span>`);
const pp = (v) => (isNum(v) ? `<span class="${cls(v)}">${v > 0 ? "+" : ""}${nf(v, 2)} pp</span>` : "–");
const ownMissing = () => `<div class="empty"><b>Data kepemilikan belum tersedia.</b><p>Register pemegang saham di atas 1% diambil setiap hari bursa pukul 16:30 WIB dari mirror register KSEI milik proyek idx.</p></div>`;

def("ownership", "ownership [BBCA]", "Pemegang saham di atas 1% (register KSEI bulanan) dan perubahannya dibanding bulan sebelumnya.", async (a) => {
  const meta = await getJSON("ownership/meta.json", true);
  if (!a.pos[0]) {
    if (!meta?.as_of) return ownMissing();
    const s = meta.summary;
    const briefCols = [{ h: "Kode", f: (r) => symLink(r.symbol) }, { h: "Pemegang", f: (r) => esc(r.holder) }, { h: "Status", f: chgKind },
      { h: "Dari", n: 1, f: (r) => (isNum(r.pct_from) ? nf(r.pct_from, 2) + "%" : "–") }, { h: "Ke", n: 1, f: (r) => (isNum(r.pct_to) ? nf(r.pct_to, 2) + "%" : "–") }, { h: "Perubahan", n: 1, f: (r) => pp(r.pct_change) }];
    return `
      <p class="muted">Register per ${tgl(meta.as_of)}${meta.prev ? `, dibandingkan dengan ${tgl(meta.prev)}` : ""}.</p>
      ${s ? `<div class="cards">${card("Pemegang baru", nf(s.new_holders))}${card("Keluar", nf(s.exits))}${card("Menambah", `<span class="up">${nf(s.increased)}</span>`)}${card("Mengurangi", `<span class="down">${nf(s.decreased)}</span>`)}${card("Net asing", pp(s.foreign_net_pp))}${card("Net lokal", pp(s.local_net_pp))}</div>
      <div class="grid wide">
        <div><h3>Kenaikan terbesar</h3>${table(briefCols, (s.top_increases || []).slice(0, 15))}</div>
        <div><h3>Penurunan terbesar</h3>${table(briefCols, (s.top_decreases || []).slice(0, 15))}</div>
        <div><h3>Per jenis investor</h3>${table([{ h: "Jenis", f: (r) => invType(r.investor_type) }, { h: "Baris", n: 1, f: (r) => nf(r.rows) }, { h: "Net", n: 1, f: (r) => pp(r.net_pp) }], s.by_investor_type || [])}</div>
      </div>` : `<p class="muted">Ringkasan perubahan belum tersedia.</p>`}
      <p class="note">Sumber: register "Pemegang Saham di Atas 1%" KSEI yang diterbitkan BEI tiap bulan, lewat mirror proyek idx. pp = poin persentase kepemilikan. Pemegang di bawah 1% tidak dipublikasikan.</p>`;
  }
  const sym = symArg(a);
  const d = await getJSON(`ownership/t/${sym}.json`, true);
  if (!d) return meta?.as_of ? `<div class="empty"><b>${esc(sym)} tidak ada di register ${tgl(meta.as_of)}.</b><p>Saham ini tidak punya pemegang di atas 1% yang tercatat, atau belum tercatat saat register dibuat.</p></div>` : ownMissing();
  return `
    ${kv([["Register", tgl(d.as_of)], ["Pemegang > 1%", nf(d.holders.length)], ["Total dikuasai", nf(d.listed_pct, 2) + "%"], ["Porsi asing", nf(d.foreign_pct, 2) + "%"],
          ["Pengendali & afiliasi", isNum(d.controller_pct) ? nf(d.controller_pct, 2) + "%" : "–"], ["Sisa (≤ 1% / publik)", isNum(d.listed_pct) ? nf(100 - d.listed_pct, 2) + "%" : "–"]])}
    <h3>Pemegang saham</h3>
    ${table([{ h: "Pemegang", f: (h) => esc(h.holder) + (h.controller_or_affiliate ? ` <span class="tag" title="${esc(h.controller_or_affiliate)}">${/AFFILIATE/.test(h.controller_or_affiliate) ? "afiliasi" : "pengendali"}</span>` : "") },
             { h: "Jenis", f: (h) => invType(h.investor_type) }, { h: "Asal", f: (h) => lf(h.local_foreign) },
             { h: "%", n: 1, f: (h) => nf(h.pct, 2) }, { h: "Lembar", n: 1, f: (h) => big(h.shares_total) }], d.holders)}
    <h3>Perubahan sejak ${tgl(d.prev)}</h3>
    ${table([{ h: "Pemegang", f: (c) => esc(c.holder) }, { h: "Status", f: chgKind }, { h: "Asal", f: (c) => lf(c.local_foreign) },
             { h: "Dari", n: 1, f: (c) => (isNum(c.pct_from) ? nf(c.pct_from, 2) + "%" : "–") }, { h: "Ke", n: 1, f: (c) => (isNum(c.pct_to) ? nf(c.pct_to, 2) + "%" : "–") },
             { h: "Perubahan", n: 1, f: (c) => pp(c.pct_change) }, { h: "Lembar", n: 1, f: (c) => sgn(c.shares_change) }], d.changes || [], "Tidak ada perubahan pemegang di atas 1%.")}
    <p class="note">Register KSEI "Pemegang Saham di Atas 1%" per ${tgl(d.as_of)}. Satu pemegang dengan beberapa rekening dijumlahkan. Pengendali dan afiliasi ditandai sesuai register (tersedia sejak 30 Okt 2026).</p>`;
}, ["own", "kepemilikan"]);

/* ---------- brief satu halaman ---------- */
const VERDICT = { undervalued: ["tergolong murah", "up"], fair: ["tergolong wajar", ""], overvalued: ["tergolong mahal", "down"], insufficient_data: ["belum bisa dinilai (data kurang)", ""] };
const TREND = { uptrend: ["naik", "up"], downtrend: ["turun", "down"], sideways: ["mendatar", ""], unknown: ["belum jelas", ""] };
const SIGNAL = { buy: ["condong positif", "up"], sell: ["condong negatif", "down"], neutral: ["netral", ""] };
const SENT = { positive: ["positif", "up"], negative: ["negatif", "down"], neutral: ["netral", ""], no_coverage: ["tidak ada berita", ""] };
const word = (map, k) => { const w = map[k]; return w ? `<b class="${w[1]}">${w[0]}</b>` : esc(k || "–"); };

def("brief", "brief BBCA", "Satu halaman: poin penting, valuasi, teknikal, return vs IHSG, dividen, pemegang saham, berita, dan grafik.", async (a, body) => {
  const sym = symArg(a);
  const s = await stock(sym);
  const [b, own, fi, rows] = await Promise.all([getJSON(`brief/${sym}.json`, true), getJSON(`ownership/t/${sym}.json`, true), fundIndex(), prices(sym)]);
  const d = b?.data || null, f = fi[sym] || {}, fu = d?.fundamentals || {};
  const pts = [];
  pts.push(`Harga terakhir <b>${nf(s.price)}</b> (${pct(s.change_pct)}) pada ${tgl(s.date)}, nilai transaksi ${big(s.value)}.`);

  // jendela return di JSON idx bernama "1m", "ytd", "1y" (bukan m1/y1)
  const win = (o, k) => (o ? o[k] ?? o[{ "1m": "m1", "1y": "y1" }[k]] : null);
  const R = d?.returns?.returns, X = d?.returns?.benchmark?.excess;
  if (R && [win(R, "1m"), win(R, "ytd"), win(R, "1y")].some(isNum)) {
    const x1y = win(X, "1y");
    pts.push(`Return 1 bulan ${pct(win(R, "1m"), 1)}, sejak awal tahun ${pct(win(R, "ytd"), 1)}, setahun ${pct(win(R, "1y"), 1)}` +
      (isNum(x1y) ? `; ${x1y >= 0 ? "lebih baik" : "lebih buruk"} <b>${nf(Math.abs(x1y), 1)} poin</b> dibanding IHSG dalam setahun.` : "."));
  } else if (rows?.length > 22) {
    const c = rows.map((r) => r[4]), n = c.length - 1;
    pts.push(`Return 1 bulan ${pct((c[n] / c[n - 21] - 1) * 100, 1)}, sekitar setahun ${pct((c[n] / c[0] - 1) * 100, 1)}.`);
  }

  const pe = f.pe ?? fu.valuation?.pe_trailing, pb = f.pb ?? fu.valuation?.price_to_book, roe = f.roe ?? fu.profitability?.roe_pct;
  const v = fu.verdict;
  if (v || isNum(pe) || isNum(pb)) {
    pts.push(`${v ? `Menurut aturan valuasi idx, saham ini ${word(VERDICT, v.label)} (skor ${v.score}). ` : ""}P/E ${nf(pe, 1)}, P/B ${nf(pb, 2)}, ROE ${isNum(roe) ? nf(roe, 1) + "%" : "–"}.`);
  }

  const an = await analystOf(sym);
  if (an?.a && isNum(an.a.target_mean)) {
    const up = upside(an.a.target_mean, s.price);
    pts.push(`Target rata-rata ${an.a.analysts ? `${an.a.analysts} analis` : "analis"} <b>${nf(an.a.target_mean)}</b> (${pct(up, 1)} dari harga sekarang)${an.a.recommendation && an.a.recommendation !== "none" ? `, rekomendasi ${recWord(an.a.recommendation)}` : ""}.`);
  }

  const t = d?.technical;
  if (t?.signal) pts.push(`Tren harga ${word(TREND, t.trend)}; sinyal teknikal ${word(SIGNAL, t.signal.label)} (skor ${t.signal.score}).`);
  else if (rows?.length > 30) {
    const sig = signals(indicators(rows)), bull = sig.filter((x) => x[1] === "bull").length, bear = sig.filter((x) => x[1] === "bear").length;
    pts.push(`Indikator teknikal: ${bull} positif, ${bear} negatif${bull - bear >= 2 ? " (condong naik)" : bear - bull >= 2 ? " (condong turun)" : ""}.`);
  }

  const dv = d?.dividends;
  if (dv) pts.push(isNum(dv.ttm_yield_pct) && dv.ttm_total
    ? `Dividen 12 bulan terakhir Rp ${nf(dv.ttm_total, 2)} per saham (yield <b>${nf(dv.ttm_yield_pct, 2)}%</b>)${dv.consecutive_years ? `, dibagikan ${dv.consecutive_years} tahun berturut-turut` : ""}${dv.last ? `; terakhir ${tgl(dv.last.date)}` : ""}.`
    : `Tidak ada dividen dalam 12 bulan terakhir.`);
  else if (isNum(f.div_yield)) pts.push(`Dividend yield ${nf(f.div_yield, 2)}%.`);

  if (own?.holders?.length) {
    const top = own.holders[0];
    pts.push(`${own.holders.length} pemegang di atas 1% menguasai <b>${nf(own.listed_pct, 1)}%</b> saham (asing ${nf(own.foreign_pct, 1)}%). Terbesar: ${esc(top.holder)} ${nf(top.pct, 2)}%.`);
  }
  if (HSC_SET.has(sym)) pts.push(`<span class="down">Masuk daftar <b>HSC</b> BEI: kepemilikan sangat terkonsentrasi, tidak dihitung dalam IHSG.</span>`);

  const nw = d?.news;
  if (nw) pts.push(nw.company_matches ? `${nw.company_matches} berita terbaru menyebut perusahaan ini; nadanya ${word(SENT, nw.sentiment)}.` : "Belum ada berita terbaru yang menyebut perusahaan ini.");

  const ain = await getJSON("ai/stocks.json", true);
  const aiNote = ain?.notes?.[sym] ? `<div class="ai-card"><div class="ai-head"><b>Catatan AI</b><span class="muted">${esc(tgl(ain.date))}</span></div><p class="ai-text">${esc(ain.notes[sym])}</p><p class="note">Ditulis AI dari data harga, teknikal dan fundamental di situs ini. Bisa keliru; bukan saran investasi.</p></div>` : "";

  const sector = [fu.sector, fu.industry].filter(Boolean).map(esc).join(" · ");
  const reasons = (title, list) => (list?.length ? `<details><summary>${title}</summary><ul>${list.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></details>` : "");
  body.innerHTML = `
    ${d?.name || sector ? `<p class="muted">${esc(d?.name || NAMES[sym] || "")}${sector ? ` · ${sector}` : ""}</p>` : ""}
    ${await ttbCard(sym)}
    ${aiNote}
    <h3>Poin penting</h3>
    <ul class="points">${pts.map((p) => `<li>${p}</li>`).join("")}</ul>
    <div class="reasons">
      ${reasons("Alasan penilaian valuasi (dari idx, bahasa Inggris)", v?.reasons)}
      ${reasons("Alasan sinyal teknikal (dari idx, bahasa Inggris)", t?.signal?.reasons)}
      ${reasons("Poin asli dari idx (bahasa Inggris)", d?.key_points)}
    </div>
    ${own?.holders?.length ? `<h3>Pemegang saham terbesar</h3>${table([{ h: "Pemegang", f: (h) => esc(h.holder) }, { h: "Asal", f: (h) => lf(h.local_foreign) }, { h: "%", n: 1, f: (h) => nf(h.pct, 2) }], own.holders.slice(0, 5))}
      <div class="btns">${cmdBtn(`ownership ${sym}`, "semua pemegang & perubahannya")}</div>` : ""}
    ${nw?.headlines?.length ? `<h3>Berita terbaru</h3><ul class="news">${nw.headlines.map((h) => `<li><a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a><span class="muted"> · ${esc(h.source || "")}${h.published ? ` · ${wib(h.published)}` : ""}</span></li>`).join("")}</ul>` : ""}
    <h3>Harga</h3>
    <div class="brief-quote"></div>
    <p class="note">${b ? `Brief disusun ${wib(b.fetched_at)} dari <code>idx stocks brief</code>${(d?.sections_failed || []).length ? `; bagian yang gagal diambil: ${esc(d.sections_failed.join(", "))}` : ""}.` : "Brief lengkap untuk saham ini belum dibuat (diambil bergilir, 100 saham per hari, yang paling aktif dulu); poin di atas disusun dari data yang sudah ada."} Penilaian valuasi dan sinyal adalah aturan sederhana, bukan saran investasi.</p>`;
  await COMMANDS.quote.fn({ pos: [sym], flags: {} }, $(".brief-quote", body));
}, ["b", "ringkasan"]);

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
const FLAG_CMDS = () => new Set(["quote", "brief", "technical", "fundamental", "analyst", "ownership", "broker", "foreign", "bandar"].map((n) => COMMANDS[n]));
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
