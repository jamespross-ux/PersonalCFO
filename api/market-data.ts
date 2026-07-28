// Vercel Edge Function: /api/market-data
// Proxies VIX (CBOE) and S&P 500 (Stooq) — both block direct browser
// requests (no CORS headers), confirmed by testing. Gold's current value now
// also comes from here (our own daily-logged history), rather than a
// separate live fetch — this makes all three indicators behave consistently
// as "yesterday's close" (VIX/S&P only ever publish once daily anyway, so
// this brings Gold in line rather than mixing live-price with EOD figures).
//
// Also returns:
//   - the last 30 days of history from the shared market_history table
//   - a "streak" for each indicator: how many consecutive logged days it
//     has moved in the same direction (e.g. down 3 days in a row)
//
// Cache-Control is explicitly "no-store" — after finding all three
// indicators appeared frozen for days across multiple devices, every layer
// of caching was removed rather than tuning a duration. This data only
// updates once a day at the source anyway, so there's no real cost to
// always fetching fresh.
//
// Set these in Vercel Project Settings -> Environment Variables:
//   SUPABASE_URL              (already set for chat.ts)
//   SUPABASE_SERVICE_ROLE_KEY (already set for chat.ts)

export const config = { runtime: 'edge' };

const HISTORY_DAYS = 30;

type Indicator = { value: number; up: boolean; streak: number };

// Walks backward from the most recent value, counting consecutive days that
// moved in the same direction. A flat day (no change) breaks the streak.
// Returns 0 if there isn't at least one direction change to measure.
function computeStreak(values: number[]): number {
  if (values.length < 2) return 0;
  let streak = 0;
  let dir: 'up' | 'down' | null = null;
  for (let i = values.length - 1; i > 0; i--) {
    const d: 'up' | 'down' | null =
      values[i] > values[i - 1] ? 'up' : values[i] < values[i - 1] ? 'down' : null;
    if (d === null) break;
    if (dir === null) { dir = d; streak = 1; }
    else if (d === dir) streak++;
    else break;
  }
  return streak;
}

export default async function handler(): Promise<Response> {
  const result: {
    vix?: Indicator;
    sp500?: Indicator;
    gold?: Indicator;
    history?: { date: string; vix: number | null; gold: number | null; sp500: number | null }[];
  } = {};

  // 30-day history from our own shared table — fetched first since gold's
  // current value now comes from here too, and streaks for all three need it.
  let history: { date: string; vix: number | null; gold: number | null; sp500: number | null }[] = [];
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceKey) {
      const cutoff = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
      const res = await fetch(
        `${supabaseUrl}/rest/v1/market_history?date=gte.${cutoff}&order=date.asc&select=date,vix,gold,sp500`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
      );
      if (res.ok) {
        history = await res.json();
        result.history = history;
      }
    }
  } catch (e) { /* omit */ }

  const streakFor = (key: 'vix' | 'gold' | 'sp500') =>
    computeStreak(history.map((h) => h[key]).filter((v): v is number => v !== null && v !== undefined));

  // VIX — live CBOE fetch for the freshest possible current value (still
  // only ever an EOD close, since that's all CBOE publishes).
  try {
    const res = await fetch('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv');
    const text = await res.text();
    const rows = text.trim().split('\n').slice(1).filter(Boolean);
    const parseClose = (row: string) => parseFloat(row.split(',')[4]);
    const last = parseClose(rows[rows.length - 1]);
    const prev = parseClose(rows[rows.length - 2]);
    if (Number.isFinite(last) && Number.isFinite(prev)) {
      result.vix = { value: last, up: last > prev, streak: streakFor('vix') };
    }
  } catch (e) { /* omit */ }

  // S&P 500 — via the SPY ETF (tracks the S&P 500 essentially 1:1), not the
  // raw index symbol. The raw index symbol was silently failing on Stooq's
  // download endpoint; SPY is a much more reliably supported symbol there.
  try {
    const res = await fetch('https://stooq.com/q/d/l/?s=spy.us&i=d');
    const text = await res.text();
    const rows = text.trim().split('\n').slice(1).filter(Boolean)
      .sort((a, b) => a.split(',')[0].localeCompare(b.split(',')[0]));
    const parseClose = (row: string) => parseFloat(row.split(',')[4]);
    const last = parseClose(rows[rows.length - 1]);
    const prev = parseClose(rows[rows.length - 2]);
    if (Number.isFinite(last) && Number.isFinite(prev)) {
      result.sp500 = { value: last, up: last > prev, streak: streakFor('sp500') };
    }
  } catch (e) { /* omit */ }

  // Gold — now sourced from our own logged history (yesterday's close),
  // matching VIX/S&P behaviour, instead of a live gold-api.com fetch.
  try {
    const goldVals = history.map((h) => h.gold).filter((v): v is number => v !== null && v !== undefined);
    if (goldVals.length >= 2) {
      const last = goldVals[goldVals.length - 1];
      const prev = goldVals[goldVals.length - 2];
      result.gold = { value: last, up: last > prev, streak: streakFor('gold') };
    }
  } catch (e) { /* omit */ }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
