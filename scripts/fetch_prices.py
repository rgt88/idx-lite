import json
import pathlib
import sys
import time
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data"
(OUT / "prices").mkdir(parents=True, exist_ok=True)

symbols = list(dict.fromkeys(s.upper() for s in (ROOT / "symbols.txt").read_text().split()))
CHUNK = 50


def num(x, nd=2):
    return None if pd.isna(x) else round(float(x), nd)


def rsi(close, n=14):
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    down = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / down)


def dump(path, obj):
    path.write_text(json.dumps(obj, separators=(",", ":")))


stocks, failed = [], []
for i in range(0, len(symbols), CHUNK):
    chunk = symbols[i:i + CHUNK]
    print(f"kelompok {i // CHUNK + 1}/{(len(symbols) - 1) // CHUNK + 1}")
    try:
        raw = yf.download(
            tickers=[f"{s}.JK" for s in chunk],
            period="1y", interval="1d", group_by="ticker",
            auto_adjust=False, threads=True, progress=False,
        )
    except Exception as e:
        print("  gagal unduh kelompok:", e)
        failed += chunk
        continue

    for sym in chunk:
        try:
            df = raw[f"{sym}.JK"] if isinstance(raw.columns, pd.MultiIndex) else raw
            df = df.dropna(subset=["Close"])
            if len(df) < 2:
                failed.append(sym)
                continue

            close = df["Close"]
            vol = df["Volume"].fillna(0)
            rows = [
                [idx.strftime("%Y-%m-%d"), round(float(o)), round(float(h)),
                 round(float(l)), round(float(c)), int(v)]
                for idx, o, h, l, c, v in zip(df.index, df["Open"], df["High"], df["Low"], close, vol)
            ]
            dump(OUT / "prices" / f"{sym}.json", rows)

            last, prev = close.iloc[-1], close.iloc[-2]
            stocks.append({
                "symbol": sym,
                "date": df.index[-1].strftime("%Y-%m-%d"),
                "price": num(last, 0),
                "change_pct": num((last - prev) / prev * 100),
                "volume": int(vol.iloc[-1]),
                "value": num(last * vol.iloc[-1], 0),
                "sma20": num(close.rolling(20).mean().iloc[-1], 0),
                "sma50": num(close.rolling(50).mean().iloc[-1], 0),
                "rsi14": num(rsi(close).iloc[-1], 1),
            })
        except Exception:
            failed.append(sym)
    time.sleep(3)

if not stocks:
    sys.exit("Tidak ada data yang berhasil diambil")

dump(OUT / "summary.json", {"updated": datetime.now(timezone.utc).isoformat(), "stocks": stocks})
print(f"selesai: {len(stocks)} berhasil, {len(failed)} dilewati")
if failed:
    print("dilewati:", " ".join(failed[:50]), "..." if len(failed) > 50 else "")
