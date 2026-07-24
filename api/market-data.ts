// Vercel Edge Function: /api/market-data
// Proxies VIX and put/call ratio from CBOE's CSV feeds (CBOE's CDN blocks
// direct browser requests — confirmed by testing). Also returns the last 30
// days of history from the shared market_history table (populated daily by
// /api/log-market-history), so the CFO chat can describe a genuine trend
// rather than just today's snapshot.
//
// Gold is NOT proxied here for its CURRENT value — gold-api.com already
// works fine as a direct browser fetch. Gold's HISTORY does come from here
// though, since gold-api.com's free tier has no confirmed historical
// endpoint — our own daily-logged history covers that gap.
//
// Set these in Vercel Project Settings -> Environment Variables:
//   SUPABASE_URL              (already set for chat.ts)
//   SUPABASE_SERVICE_ROLE_KEY (already set for chat.ts)

export const config = { runtime: 'edge' };

const HISTORY_DAYS = 30;

export default async function handler(): Promise<Response> {
  const result: {
    vix?: { value: number; up: boolean };
    putCall?: { value: number; up: boolean };
    history?: { date: string; vix: number | null; gold: number | null; put_call: number | null }[];
  } = {};

  // VIX — standard CBOE format: DATE,OPEN,HIGH,LOW,CLOSE
  try {
    const res = await fetch('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv');
    const text = await res.text();
    const rows = text.trim().split('\n').slice(1).filter(Boolean);
    const parseClose = (row: string) => parseFloat(row.split(',')[4]);
    const last = parseClose(rows[rows.length - 1]);
    const prev = parseClose(rows[rows.length - 2]);
    if (Number.isFinite(last) && Number.isFinite(prev)) {
      result.vix = { value: last, up: last > prev };
    }
  } catch (e) { /* omit */ }

  // Put/Call ratio
  try {
    const res = await fetch('https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/indexpcarchive.csv');
    const text = await res.text();
    const lines = text.trim().split('\n');
    const headerIdx = lines.findIndex((l) => l.startsWith('Trade_date'));
    if (headerIdx >= 0) {
      const rows = lines.slice(headerIdx + 1).filter(Boolean);
      const parseRatio = (row: string) => parseFloat(row.split(',')[4]);
      const last = parseRatio(rows[rows.length - 1]);
      const prev = parseRatio(rows[rows.length - 2]);
      if (Number.isFinite(last) && Number.isFinite(prev)) {
        result.putCall = { value: last, up: last > prev };
      }
    }
  } catch (e) { /* omit */ }

  // 30-day history from our own shared table (needs Supabase — separate
  // try/catch so a Supabase hiccup doesn't take down the live VIX/P-C chips
  // above, which don't depend on it).
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceKey) {
      const cutoff = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
      const res = await fetch(
        `${supabaseUrl}/rest/v1/market_history?date=gte.${cutoff}&order=date.asc&select=date,vix,gold,put_call`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
      );
      if (res.ok) result.history = await res.json();
    }
  } catch (e) { /* omit */ }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=0, s-maxage=1800',
    },
  });
}
