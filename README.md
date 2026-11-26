# TradingAnalyzer

A full-featured, browser-based charting & trading platform in the style of professional charting terminals — written from scratch in vanilla JavaScript (no build step, no dependencies). Open `index.html` via any static web server (or GitHub Pages) and it runs.

## Features

**Charting engine (custom HTML5 canvas)**
- 13 chart types: Bars, Candles, Hollow candles, Line, Line with markers, Step line, Area, Baseline, Columns, High-low, Heikin Ashi, Renko, Line break
- 14 intervals (1m → 1M) with favorites, plus "type a number" interval change
- Price scale modes: auto, regular, percent, logarithmic, inverted; drag axes to scale, double-click to reset
- Mouse-wheel / pinch zoom, drag / touch panning, infinite history loading when scrolling left
- Multiple resizable indicator panes, legend with OHLC & live values, last-price label with bar-close countdown, high/low markers, watermark
- Crosshair (cross / dot / arrow), magnet modes, time zones, symbol comparison overlays
- Multi-chart layouts (1, 2, 3, 4, 6 charts) with symbol / interval / crosshair sync
- Bar Replay (play, step, speed), snapshots (download / clipboard), CSV export, layout import/export

**45+ indicators** — Volume, SMA, EMA, WMA, HMA, VWMA, DEMA, TEMA, ALMA, LSMA, MA Cross, MA Ribbon, Bollinger Bands (+ %B, Width), Keltner, Donchian, Envelopes, Ichimoku, Parabolic SAR, Supertrend, VWAP, Zig Zag, Pivot Points, Linear Regression, RSI, MACD, Stochastic, Stoch RSI, CCI, ATR, DMI/ADX, Williams %R, MFI, OBV, A/D, CMF, Momentum, ROC, Awesome Oscillator, Aroon, TRIX, Ultimate Oscillator, Chande MO, DPO, Std Dev, Historical Volatility, Elder Force, KST, Volume Oscillator. Fully editable inputs and styles, indicator templates.

**50+ drawing tools** — trend line, ray, info line, extended line, trend angle, arrow, horizontal line/ray, vertical line, cross line, parallel channel, regression trend, pitchfork, Fib retracement / extension / time zone / speed fan, Gann fan, XABCD, ABCD, triangle, head & shoulders, three drives, Elliott waves, long/short position, projection, price/date ranges, brush, highlighter, rectangle, circle, ellipse, triangle, path, polyline, curve, arc, text, note, callout, comment, price label, price note, signpost, arrow marks, flag, emoji. Floating style toolbar, settings dialog (style/text/coordinates), lock/hide/clone, undo/redo, object tree, favorites bar, per-symbol persistence.

**Panels** — Watchlist with sections & live flashing quotes, symbol details (day range, performance, technical-rating gauge), price alerts (draggable on chart, sound + browser notifications), Data Window, Object Tree, Hotlists, Stock Screener (technical rating, RSI, performance, volatility), Script Editor (write custom JavaScript indicators with a `ta.*` library), Strategy Tester (6 built-in strategies, equity curve, trade list), Paper Trading (market/limit/stop orders, TP/SL, draggable order lines, positions & P&L).

**Responsive** — desktop, tablet and phone layouts (bottom navigation, slide-out drawing tools, full-screen panels and bottom-sheet dialogs), dark & light themes, keyboard shortcuts.

## Market data
- **Crypto** (28 USDT pairs): real-time data from Binance's public market-data API (REST + WebSocket), with automatic REST polling fallback.
- **Stocks, indices, forex, futures, bonds**: there is no free, keyless, browser-accessible real-time feed for these, so they run on a deterministic **market simulator** and are clearly labelled `SIM` in the UI. If Binance is unreachable, crypto also falls back to the simulator.

## Google sign-in & cloud save
Click **Sign in** (top-right) → **Continue with Google**. Once signed in, everything is saved to your account and synced live across devices: chart layouts, indicators & templates, all drawings, alerts & alert log, watchlists, the paper-trading account, custom scripts, strategy settings and chart preferences. Signing in on a new device downloads your saved workspace; changes made on another device appear with a "Reload" prompt.

This uses a free **Firebase** project (Google Authentication + Cloud Firestore). One-time setup:
1. Create a project at https://console.firebase.google.com
2. **Authentication** → Sign-in method → enable **Google**; under Settings → Authorized domains add your site domain (e.g. `anaskhan2581-star.github.io`).
3. **Firestore Database** → Create database, then paste `firestore.rules` into the Rules tab and Publish (each user can only access their own data).
4. **Project settings** → Your apps → add a Web app and copy its `firebaseConfig` into `js/firebase-config.js`.

Until configured, the app works fully offline/local and the Sign in button shows these steps (you can also paste the config there to test in one browser).

## Running locally
```bash
python3 -m http.server 8000
# open http://localhost:8000
```
(ES modules need to be served over HTTP; opening the file directly will not work.)

All state is stored in your browser's localStorage, and additionally in your account when signed in.
