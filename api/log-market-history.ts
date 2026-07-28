// Vercel Edge Function: /api/log-market-history
// Triggered once a day by Vercel Cron (see vercel.json). Fetches VIX,
// S&P 500, and gold price, then upserts today's values into the shared
// market_history table so the CFO chat can reference a genuine multi-day
// trend, not just today's snapshot.
//
// Upserts by date (on_conflict=date), so if this ever runs twice in one day
// (e.g. a manual test trigger), it safely overwrites today's row rather
// than creating a duplicate.
//
// Set these in Vercel Project Settings -> Environment Variables:
//   SUPABASE_URL              (already set for chat.ts / check-inactive.ts)
//   SUPABASE_SERVICE_ROLE_KEY (already set for chat.ts / check-inactive.ts)
//
// CRON_SECRET must already be set (same as check-inactive.ts) — this route
// checks it to make sure only Vercel's own scheduler can trigger it.

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return new Response('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.', { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const row: { date: string; vix?: number; gold?: number; sp500?: number } = { date: today };

  // VIX
  try {
    const res = await fetch('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv');
    const text = await res.text();
    const rows = text.trim().split('\n').slice(1).filter(Boolean);
    const value = parseFloat(rows[rows.length - 1].split(',')[4]);
    if (Number.isFinite(value)) row.vix = value;
  } catch (e) { /* omit */ }

  // S&P 500 — Stooq daily CSV
  try {
    const res = await fetch('https://stooq.com/q/d/l/?s=%5Espx&i=d');
    const text = await res.text();
    const rows = text.trim().split('\n').slice(1).filter(Boolean)
      .sort((a, b) => a.split(',')[0].localeCompare(b.split(',')[0]));
    const value = parseFloat(rows[rows.length - 1].split(',')[4]);
    if (Number.isFinite(value)) row.sp500 = value;
  } catch (e) { /* omit */ }

  // Gold
  try {
    const res = await fetch('https://api.gold-api.com/price/XAU');
    const json = await res.json();
    const value = Number(json.price ?? json.price_usd ?? json.value ?? json.rate);
    if (Number.isFinite(value)) row.gold = value;
  } catch (e) { /* omit */ }

  if (row.vix === undefined && row.gold === undefined && row.sp500 === undefined) {
    return new Response(JSON.stringify({ logged: false, reason: 'all fetches failed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const upsertRes = await fetch(`${supabaseUrl}/rest/v1/market_history?on_conflict=date`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });

  return new Response(JSON.stringify({ logged: upsertRes.ok, row }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
