import { Observable, retry } from "rxjs";
import type { AlphaEnvelope, StreamAlphaTick } from "@/types/telemetry";

const COINBASE_FEED_URL = "wss://ws-feed.exchange.coinbase.com";
const RECONNECT_DELAY_MS = 3000;

export const COINBASE_PRODUCT_IDS = [
  "BTC-USD",
  "ETH-USD",
  "SOL-USD",
  "XRP-USD",
  "DOGE-USD",
  "LTC-USD",
];

interface CoinbaseTickerMessage {
  type: "ticker";
  product_id: string;
  price: string;
  open_24h: string;
  high_24h: string;
  low_24h: string;
  best_bid: string;
  best_ask: string;
  best_bid_size: string;
  best_ask_size: string;
  last_size: string;
}

function isCoinbaseTicker(value: unknown): value is CoinbaseTickerMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    message.type === "ticker" &&
    typeof message.product_id === "string" &&
    typeof message.price === "string" &&
    typeof message.open_24h === "string" &&
    typeof message.high_24h === "string" &&
    typeof message.low_24h === "string" &&
    typeof message.best_bid === "string" &&
    typeof message.best_ask === "string" &&
    typeof message.best_bid_size === "string" &&
    typeof message.best_ask_size === "string" &&
    typeof message.last_size === "string"
  );
}

function toAlphaEnvelope(
  message: CoinbaseTickerMessage,
  nextId: () => number
): AlphaEnvelope | null {
  const price = Number(message.price);
  const open = Number(message.open_24h);
  const high = Number(message.high_24h);
  const low = Number(message.low_24h);
  const bid = Number(message.best_bid);
  const ask = Number(message.best_ask);
  const volume = Number(message.last_size);
  const bidSize = Number(message.best_bid_size);
  const askSize = Number(message.best_ask_size);
  const numbers = [price, open, high, low, bid, ask, volume, bidSize, askSize];
  if (numbers.some((value) => !Number.isFinite(value)) || open === 0) {
    return null;
  }

  const payload: StreamAlphaTick = {
    id: nextId(),
    symbol: message.product_id,
    exchange: "COINBASE",
    price,
    previousClose: open,
    changePercent: ((price - open) / open) * 100,
    bid,
    ask,
    bidSize,
    askSize,
    spread: ask - bid,
    volume,
    volatility: ((high - low) / open) * 100,
    timestamp: Date.now(),
  };
  return { stream: "alpha", payload };
}

/**
 * Live Stream Alpha source backed by Coinbase's public ticker channel.
 * Reconnects automatically after any socket failure or close.
 */
export function createCoinbaseAlphaFeed(
  nextId: () => number
): Observable<AlphaEnvelope> {
  return new Observable<AlphaEnvelope>((subscriber) => {
    const socket = new WebSocket(COINBASE_FEED_URL);

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: "subscribe",
          product_ids: COINBASE_PRODUCT_IDS,
          channels: ["ticker"],
        })
      );
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!isCoinbaseTicker(parsed)) return;
      const envelope = toAlphaEnvelope(parsed, nextId);
      if (envelope) subscriber.next(envelope);
    };

    socket.onerror = () => {
      subscriber.error(new Error("Coinbase feed connection failed."));
    };

    socket.onclose = () => {
      subscriber.error(new Error("Coinbase feed connection closed."));
    };

    return () => {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    };
  }).pipe(retry({ delay: RECONNECT_DELAY_MS }));
}
