export interface FxCurrency {
  code: string;
  pair: string;
  /** True when the market convention quotes this as CCY/USD (so we invert the USD-based rate). */
  invert: boolean;
}

export const FX_CURRENCIES: FxCurrency[] = [
  { code: "EUR", pair: "EUR/USD", invert: true },
  { code: "GBP", pair: "GBP/USD", invert: true },
  { code: "JPY", pair: "USD/JPY", invert: false },
  { code: "CHF", pair: "USD/CHF", invert: false },
  { code: "CAD", pair: "USD/CAD", invert: false },
  { code: "AUD", pair: "AUD/USD", invert: true },
  { code: "CNY", pair: "USD/CNY", invert: false },
  { code: "INR", pair: "USD/INR", invert: false },
  { code: "MXN", pair: "USD/MXN", invert: false },
  { code: "BRL", pair: "USD/BRL", invert: false },
  { code: "KRW", pair: "USD/KRW", invert: false },
  { code: "SEK", pair: "USD/SEK", invert: false },
];

export const FX_SYMBOLS = FX_CURRENCIES.map((currency) => currency.code).join(",");

export const DXY_SERIES_ID = "fx:DXY";

/** Weights of the ICE US Dollar Index formula. */
export const DXY_WEIGHTS: { code: string; weight: number; invert: boolean }[] = [
  { code: "EUR", weight: -0.576, invert: true },
  { code: "JPY", weight: 0.136, invert: false },
  { code: "GBP", weight: -0.119, invert: true },
  { code: "CAD", weight: 0.091, invert: false },
  { code: "SEK", weight: 0.042, invert: false },
  { code: "CHF", weight: 0.036, invert: false },
];
export const DXY_CONSTANT = 50.14348112;

export interface MetalSpec {
  symbol: string;
  label: string;
  unit: string;
}

export const METALS: MetalSpec[] = [
  { symbol: "XAU", label: "Gold", unit: "USD/oz" },
  { symbol: "XAG", label: "Silver", unit: "USD/oz" },
  { symbol: "XPT", label: "Platinum", unit: "USD/oz" },
  { symbol: "XPD", label: "Palladium", unit: "USD/oz" },
  { symbol: "HG", label: "Copper", unit: "USD/lb" },
];

export interface City {
  name: string;
  lat: number;
  lon: number;
}

export const CITIES: City[] = [
  { name: "New York", lat: 40.71, lon: -74.01 },
  { name: "Los Angeles", lat: 34.05, lon: -118.24 },
  { name: "London", lat: 51.51, lon: -0.13 },
  { name: "Cairo", lat: 30.04, lon: 31.24 },
  { name: "Lagos", lat: 6.52, lon: 3.38 },
  { name: "Delhi", lat: 28.61, lon: 77.21 },
  { name: "Beijing", lat: 39.91, lon: 116.41 },
  { name: "Tokyo", lat: 35.68, lon: 139.69 },
  { name: "Sydney", lat: -33.87, lon: 151.21 },
  { name: "Sao Paulo", lat: -23.55, lon: -46.63 },
];

export interface NewsFeed {
  id: string;
  url: string;
  source: string;
  category: "politics" | "world" | "business";
}

export const NEWS_FEEDS: NewsFeed[] = [
  { id: "bbc-world", url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC World", category: "world" },
  { id: "bbc-politics", url: "https://feeds.bbci.co.uk/news/politics/rss.xml", source: "BBC Politics", category: "politics" },
  { id: "bbc-business", url: "https://feeds.bbci.co.uk/news/business/rss.xml", source: "BBC Business", category: "business" },
  { id: "guardian-world", url: "https://www.theguardian.com/world/rss", source: "The Guardian", category: "world" },
  { id: "npr", url: "https://feeds.npr.org/1001/rss.xml", source: "NPR", category: "world" },
  { id: "aljazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera", category: "world" },
];

export interface SocialTopic {
  tag: string;
  topic: string;
}

/**
 * Mastodon hashtags mapped to the Beta stream's topic names. `$SYM` topics line
 * up with the Coinbase symbols so the lead/lag correlations can join on them.
 */
export const SOCIAL_TOPICS: SocialTopic[] = [
  { tag: "bitcoin", topic: "$BTC" },
  { tag: "ethereum", topic: "$ETH" },
  { tag: "solana", topic: "$SOL" },
  { tag: "xrp", topic: "$XRP" },
  { tag: "dogecoin", topic: "$DOGE" },
  { tag: "litecoin", topic: "$LTC" },
  { tag: "gold", topic: "$PAXG" },
  { tag: "chainlink", topic: "$LINK" },
  { tag: "politics", topic: "Politics" },
  { tag: "economy", topic: "Economy" },
  { tag: "election", topic: "Election" },
  { tag: "ai", topic: "AI" },
];

export const WORLD_BANK_COUNTRIES = "USA;CHN;DEU;JPN;GBR;IND";
