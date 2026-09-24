# PulseEngine

A browser-native, real-time financial and sentiment telemetry dashboard. Three
telemetry streams are batched with RxJS, appended to an in-memory DuckDB-Wasm
database running in a Web Worker, and queried live to drive Apache ECharts
panels. All analytics, including the forecasting models, are DuckDB SQL running
in the worker. There is no backend.

| Stream | Content | Source |
| --- | --- | --- |
| Alpha | Market ticks with order-book sizes | Synthetic random walk (default) or live Coinbase feed |
| Beta | Social sentiment, post volume, influencer reach | Synthetic |
| Gamma | IoT diagnostics for 12 devices | Synthetic |

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. `npm install`, `npm run dev` and `npm run build`
copy the DuckDB-Wasm binaries from `node_modules` into `public/duckdb/`
(gitignored), so the app has no CDN dependency and works offline.

```bash
npm test       # SQL, advisor, alert and guard tests against a real DuckDB
npm run lint
npm run build
```

## What is on screen

- **Market feed:** OHLC candlesticks with stacked volume, 10s/60s SMAs, 20s
  Bollinger bands and a 60s regression trend line. The indicators attach to the
  first visible symbol. Click legend entries to show or hide symbols and
  overlays; the mouse wheel or bottom slider zooms. Zooming locks the chart on
  that window (candles that are unusually volatile are shaded) until you press
  "Zoom locked - reset".
- **Time range:** `1m`, `5m`, `15m` and `Live` re-window every query and chart.
  Candle width scales with the range (1s, 2s, 10s, 30s).
- **KPI cards:** each shows a change tag against the previous window
  (e.g. `+2.4% ▲`). Sentiment change is shown in points because it hovers
  around zero.
- **Threshold alerts:** a pulsing ring and a toast fire when any topic's
  15-second sentiment drops below -0.5 or any device exceeds 85°C.
- **Device status:** number of devices currently nominal, warning, throttled or
  offline (latest reading per device).
- **Console:** export a table from the live buffer as CSV or Parquet, or run
  read-only SQL (one statement; `SELECT`, `WITH`, `FROM`, `VALUES`, `DESCRIBE`,
  `SHOW`, `EXPLAIN`, `SUMMARIZE`; 500 rows displayed). The guard runs inside
  the worker, not only in the UI.

## Predictions, analysis and advice

The forecasting panel refreshes every second from one worker request that runs
these queries over the in-memory buffer:

- **Trend lines:** `REGR_SLOPE`, `REGR_INTERCEPT` and `REGR_R2` per symbol over
  60s, giving a slope in %/min and a 30s projection.
- **Alpha signals:** order-book imbalance `(bid - ask) / (bid + ask)` over 10s,
  Bollinger z-score, and 10s/60s SMA crossovers from time-based window
  functions.
- **Beta signals:** post velocity (posts/s) against a 60s baseline, follower-
  weighted sentiment and an influencer impact score.
- **Gamma forecasts:** memory leak rate (%/min, linear fit) with time to
  exhaustion, and an exponential thermal fit (`REGR_SLOPE(ln(temp), t)`) with
  time to reach the 85°C throttle point.
- **Correlation matrix:** 5s sentiment change against the forward price return
  at 10s, 30s and 60s lags, and 5s social-volume change against |return|. A
  cell is marked `*` only if it clears |r| >= 0.3 and roughly a 99% bar for its
  sample size, so a lone noisy value is not reported as a leading indicator.
- **Advice:** plain-text rules over those results, ranked by severity.

These are statistical signals, not financial advice. In synthetic mode the
price responds to sentiment with a planted 20s lag so the detectors have
something to find; real markets will not behave that way.

## Live market data

Stream Alpha can read real ticks from Coinbase's public ticker WebSocket (no API
key). Create `.env.local` and restart the dev server:

```
NEXT_PUBLIC_ALPHA_FEED=coinbase
```

Leave it unset for synthetic data. The live feed tracks BTC, ETH, SOL, XRP, DOGE
and LTC against USD and reconnects automatically. Sentiment and IoT data stay
synthetic.

## How it works

- `src/types/` - stream and analytics types, range definitions, retention.
- `src/analytics/` - `schema.ts` (tables, insert SQL), `sql.ts` (every chart,
  KPI and forecasting query), `sqlGuard.ts`, `advisor.ts`, `alerts.ts`. These
  have no runtime imports so the tests run them directly under Node.
- `src/telemetry/generators.ts` - synthetic streams, with an injectable clock and
  RNG for tests.
- `src/hooks/useTelemetryPipeline.ts` - generates traffic, batches it with
  `bufferTime(16)`, inserts each batch into DuckDB, and every 5 seconds deletes
  rows older than `RETENTION_WINDOW_MS`.
- `src/workers/duckdb.worker.ts` - owns the DuckDB-Wasm instance and serves
  insert, evict, query, forecast, user-query and export requests over
  `postMessage`.
- `src/components/` - `Dashboard.tsx` (polling loop and layout), chart option
  builders, the console modal and the forecasting panel.

Retention is 15 minutes so the widest range (`15m`) has data to show. Change
`RETENTION_WINDOW_MS` in `src/types/analytics.ts` to trade memory for history.

## Browser support

DuckDB-Wasm runs in a worker started from inside the DuckDB worker, so the
browser must support nested Web Workers. This is verified in Chromium only;
Firefox and Safari are untested. If nested workers are unavailable the header
shows an error explaining why. Charts pause while the tab is hidden, because
they are driven by `requestAnimationFrame`.
