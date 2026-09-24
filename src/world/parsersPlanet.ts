import type { WorldEventKind, WorldEventRow, WorldMetricRow } from "../types/world.ts";
import { CITIES } from "./constants.ts";

type Json = Record<string, unknown>;

function num(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function metric(
  seriesId: string,
  category: WorldMetricRow["category"],
  label: string,
  value: number,
  unit: string,
  source: string,
  timestamp: number,
  aux: number | null = null,
  url: string | null = null
): WorldMetricRow {
  return { seriesId, category, label, value, aux, unit, source, url, timestamp };
}

// Earthquakes (USGS) ------------------------------------------------------

export function parseUsgsQuakes(json: Json): WorldEventRow[] {
  if (!Array.isArray(json.features)) return [];
  const out: WorldEventRow[] = [];
  for (const feature of json.features as Json[]) {
    const props = feature.properties as Json | undefined;
    const coords = (feature.geometry as Json | undefined)?.coordinates;
    const magnitude = num(props?.mag);
    const time = num(props?.time);
    if (!props || !Array.isArray(coords) || magnitude === null || time === null) continue;
    const lon = num(coords[0]);
    const lat = num(coords[1]);
    if (lon === null || lat === null) continue;
    out.push({
      id: `usgs:${String(feature.id)}`,
      kind: "quake",
      title: `M${magnitude.toFixed(1)} – ${String(props.place ?? "unknown location")}`,
      magnitude,
      unit: "M",
      lat,
      lon,
      url: typeof props.url === "string" ? props.url : null,
      timestamp: time,
    });
  }
  return out;
}

// Natural events (NASA EONET) ------------------------------------------------

const EONET_KIND: Record<string, WorldEventKind> = {
  severeStorms: "storm",
  wildfires: "wildfire",
  volcanoes: "volcano",
  floods: "flood",
  earthquakes: "quake",
};

export function parseEonet(json: Json): WorldEventRow[] {
  if (!Array.isArray(json.events)) return [];
  const out: WorldEventRow[] = [];
  for (const event of json.events as Json[]) {
    const geometry = event.geometry;
    if (!Array.isArray(geometry) || geometry.length === 0) continue;
    const latest = geometry[geometry.length - 1] as Json;
    const coords = latest.coordinates;
    if (latest.type !== "Point" || !Array.isArray(coords)) continue;
    const lon = num(coords[0]);
    const lat = num(coords[1]);
    const date = typeof latest.date === "string" ? Date.parse(latest.date) : NaN;
    if (lon === null || lat === null || !Number.isFinite(date) || typeof event.title !== "string") continue;

    const categoryId = String((event.categories as Json[] | undefined)?.[0]?.id ?? "");
    out.push({
      id: `eonet:${String(event.id)}`,
      kind: EONET_KIND[categoryId] ?? "other",
      title: event.title,
      magnitude: num(latest.magnitudeValue),
      unit: typeof latest.magnitudeUnit === "string" ? latest.magnitudeUnit : null,
      lat,
      lon,
      url: typeof event.link === "string" ? event.link : null,
      timestamp: date,
    });
  }
  return out;
}

// Space weather (NOAA) and the ISS ---------------------------------------------

export function parseKp(json: unknown): WorldMetricRow[] {
  if (!Array.isArray(json)) return [];
  const out: WorldMetricRow[] = [];
  for (const row of json as Json[]) {
    const kp = num(row.Kp);
    const time = typeof row.time_tag === "string" ? Date.parse(`${row.time_tag}Z`) : NaN;
    if (kp === null || !Number.isFinite(time)) continue;
    out.push(
      metric("space:KP", "space", "Geomagnetic Kp index", kp, "Kp", "NOAA SWPC", time, null, "https://www.swpc.noaa.gov")
    );
  }
  return out;
}

export function parseIss(json: Json, now: number): WorldMetricRow[] {
  const latitude = num(json.latitude);
  const longitude = num(json.longitude);
  if (latitude === null || longitude === null) return [];
  const seconds = num(json.timestamp);
  const timestamp = seconds !== null ? seconds * 1000 : now;
  const source = "wheretheiss.at";
  const rows = [
    metric("iss:LAT", "space", "ISS latitude", latitude, "deg", source, timestamp),
    metric("iss:LON", "space", "ISS longitude", longitude, "deg", source, timestamp),
  ];
  const altitude = num(json.altitude);
  const velocity = num(json.velocity);
  if (altitude !== null) rows.push(metric("iss:ALT", "space", "ISS altitude", altitude, "km", source, timestamp));
  if (velocity !== null) rows.push(metric("iss:VEL", "space", "ISS velocity", velocity, "km/h", source, timestamp));
  return rows;
}

// Weather and air quality (Open-Meteo) --------------------------------------------

function locations(json: unknown): Json[] {
  if (Array.isArray(json)) return json as Json[];
  return json && typeof json === "object" ? [json as Json] : [];
}

function parseTime(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Date.parse(`${value}Z`) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseWeather(json: unknown, now: number): WorldMetricRow[] {
  const out: WorldMetricRow[] = [];
  locations(json).forEach((location, index) => {
    const city = CITIES[index];
    const current = location.current as Json | undefined;
    const temperature = num(current?.temperature_2m);
    if (!city || !current || temperature === null) return;
    out.push(
      metric(
        `wx:TEMP:${city.name}`,
        "weather",
        `${city.name} temperature`,
        temperature,
        "°C",
        "Open-Meteo",
        parseTime(current.time, now),
        num(current.wind_speed_10m),
        "https://open-meteo.com"
      )
    );
  });
  return out;
}

export function parseAirQuality(json: unknown, now: number): WorldMetricRow[] {
  const out: WorldMetricRow[] = [];
  locations(json).forEach((location, index) => {
    const city = CITIES[index];
    const current = location.current as Json | undefined;
    const aqi = num(current?.us_aqi);
    if (!city || !current || aqi === null) return;
    out.push(
      metric(
        `aq:${city.name}`,
        "weather",
        `${city.name} air quality`,
        aqi,
        "AQI",
        "Open-Meteo",
        parseTime(current.time, now),
        num(current.pm2_5),
        "https://open-meteo.com"
      )
    );
  });
  return out;
}

export function weatherUrl(): string {
  const lat = CITIES.map((c) => c.lat).join(",");
  const lon = CITIES.map((c) => c.lon).join(",");
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,weather_code`;
}

export function airQualityUrl(): string {
  const lat = CITIES.map((c) => c.lat).join(",");
  const lon = CITIES.map((c) => c.lon).join(",");
  return `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5`;
}
