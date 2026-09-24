# PulseEngine World

PulseEngine with a real-world data layer. It is a copy of the original
PulseEngine dashboard (candlesticks, DuckDB-Wasm analytics, forecasting, SQL
console) that now also pulls live public data: currencies, gold and other
metals, politics (prediction markets), news, social posts, earthquakes and
other hazards, space weather, weather, air quality and macro indicators.

Everything runs in the browser. There is no backend and no API key: the page
calls each public API directly, writes the results into an in-memory DuckDB
database in a Web Worker, and every panel is a SQL query over those tables.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Use the **MARKETS / WORLD** switch in the header.
The first load needs internet access; the DuckDB binaries themselves are served
locally.

```bash
npm test     # 53 tests: parsers, SQL, scheduler, advisor, index (uses captured real responses)
npm run lint
npm run build
```

## What is live and what is simulated

Every panel carries a badge: `LIVE` for real data, `SIM` for locally generated.

| Stream / panel | Source | Default |
| --- | --- | --- |
| Market ticks (candles, indicators, forecasts) | Coinbase WebSocket: BTC, ETH, SOL, XRP, DOGE, LTC, LINK and **PAXG** (gold token) | live |
| Social posts (Beta stream) | Mastodon public hashtag timelines, 12 topics | live |
| IoT diagnostics (Gamma stream) | no public source exists | **simulated** |
| Currencies | Frankfurter (ECB reference rates), 12 pairs plus a USD index using the ICE formula, 90 days of history | live |
| Metals | gold-api.com spot: gold, silver, platinum, palladium, copper; gold history from the PAXG token | live |
| Politics | Polymarket and Kalshi prediction markets (politics, elections, world, economics) | live |
| News | BBC (world, politics, business), The Guardian, NPR, Al Jazeera via rss2json; Hacker News; Wikipedia's most-read articles | live |
| Planet | USGS earthquakes, NASA EONET storms, fires and volcanoes, NOAA Kp index, ISS position | live |
| Weather and air quality | Open-Meteo, 10 cities | live |
| Macro | Crypto Fear & Greed, US Treasury average rates, World Bank GDP, inflation and unemployment, CoinGecko, mempool.space | live |

Set any of these in `.env.local` to change the defaults:

```
NEXT_PUBLIC_ALPHA_FEED=synthetic   # coinbase (default) | synthetic
NEXT_PUBLIC_BETA_FEED=synthetic    # mastodon (default) | synthetic
NEXT_PUBLIC_WORLD=off              # on (default) | off, hides the World view and skips its requests
```

## The World view

- **World pulse:** a 0-100 mood index from crypto fear and greed, gold's move,
  dollar strength, Bitcoin momentum, news tone, social tone and physical
  hazards. Missing components are skipped and the weights renormalised. It is a
  transparent heuristic, not an official index, and every component is shown.
- **Observations:** plain-text notes from the data: sharp gold or dollar moves,
  a flight to safety (gold up while Bitcoin falls), large prediction-market
  repricings (only liquid markets), an inverted Treasury curve, strong quakes,
  geomagnetic storms, unhealthy air, and the strongest asset correlations.
- **Currencies, metals, politics, news, social, planet, weather, macro:**
  sparklines, 1-day and multi-day changes, probability bars, tone chips, a
  hazard map with the ISS track, and a country scoreboard.
- **Cross-asset correlation:** daily-return correlations between Bitcoin,
  Ethereum, gold, the USD index and major currencies over 60 days, computed with
  DuckDB `corr` after aligning weekend crypto candles to weekday FX.
- **Data sources:** live status of every feed, with row counts, last update and
  automatic backoff for failures.

The console can query and export the new tables: `world_metrics`,
`world_headlines` and `world_events`.

## How it works

- `src/world/` - `parsers*.ts` turn each API's real response shape into rows
  (pure functions), `sources.ts` lists every source with its URL and interval,
  `scheduler.ts` runs them with non-overlapping polls, exponential backoff and
  per-source health, `tone.ts` is the word-list tone scorer.
- `src/analytics/world*.ts` - the SQL for latest values, sparklines, the
  summary, cross-asset correlation and social topics; the mood index; the
  advisor rules.
- `src/analytics/schema.ts` - the three world tables use primary keys and
  `ON CONFLICT DO NOTHING`, so repeated polls never duplicate rows. Slow macro
  series are never evicted; fast series and transient events are.
- `src/hooks/mastodonFeed.ts` - Mastodon posts become Beta-stream rows, using the
  author's follower count as reach.
- `src/components/world/` - the World view.

## Limits and honest notes

- **Tone is a word list.** Headline and post tone come from a small lexicon with
  negation handling. It is a rough gauge, not sentiment analysis.
- **Prediction markets are not polls.** They show what traders will pay, and thin
  markets can move on one trade, so the advisor ignores low-volume ones.
- **Oil and GDELT are missing.** No free oil price is reachable from a browser,
  and GDELT blocks browser requests.
- **News passes through rss2json**, a third-party gateway that turns RSS into
  JSON. It sees which feeds you request. Every other source is called directly,
  which means those services see your IP address like any website would.
- **Traffic.** Kalshi responses are 1-3 MB and are polled every 10 minutes;
  spot metals poll every minute. Nothing polls faster than every 30 seconds
  except the live WebSocket and Mastodon loops.
- **Daily FX is daily.** ECB reference rates update once per working day; the
  intraday dollar move is not available for free.
- Not financial advice. Charts pause while the browser tab is hidden.

`scripts/capture-fixtures.mjs` re-fetches every API and refreshes the fixtures
under `tests/fixtures/` if a provider changes its response format.

## Everything from the original

The market view, forecasting panel, alerts, time ranges, SQL console and export
work as before; see the original project for the details. Retention for the
streaming tables is 15 minutes (`RETENTION_WINDOW_MS` in
`src/types/analytics.ts`).

Browser support is verified in Chromium only: DuckDB-Wasm starts a worker from
inside its own worker.
