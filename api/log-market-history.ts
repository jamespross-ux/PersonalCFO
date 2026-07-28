// Vercel Edge Function: /api/log-market-history
// Triggered once a day by Vercel Cron (see vercel.json). Fetches VIX,
// S&P 500, and gold price, then upserts today's values into the shared
// market_history table so the CFO chat can reference a genuine multi-day
// trend, not just today's snapshot.
//
// S&P 500 source history (three attempts before this one worked):
//   1. Stooq (raw index symbol) — silently failed, Stooq blocks automated
//      requests (documented CAPTCHA protection).
//   2. Stooq (SPY ETF symbol, as a fallback) — also silently failed, same reason.
//   3. FRED (Federal Reserve) CSV — genuinely works everywhere else (verified
//      via curl and pandas in independent real-world projects), but times
//      out specifically when fetched from Vercel's Edge network.
//   4. Yahoo Finance's chart API (current) — the same endpoint that powers
//      their live website, built for real-time production traffic rather
//      than an archive/CSV service. Unofficial (not a published Yahoo
//      product) but widely used in production (e.g. the yfinance library).
//
// IMPORTANT — every fetch has an explicit timeout (8 seconds each) and all
// three run in parallel. A previous version had no timeout at all, and one
// hanging request blocked the ENTIRE function until Vercel's own 25s limit
// killed it — meaning even VIX and Gold, which were working fine on their
// own, never got logged that day either. Each source now fails fast and
// independently instead.
//
// Upserts by date (on_conflict=date), so if this ever runs twice in one day
// (e.g. a manual test trigger), it safely overwrites today's row rather
// than creating a duplicate.
//
// This returns a non-200 status if the database write actually fails, with
// Supabase's real error message included, rather than always reporting
// success regardless of outcome.
//
// Set these in Vercel Project Settings -> Environment Variables:
//   SUPABASE_URL              (already set for chat.ts / check-inactive.ts)
//   SUPABASE_SERVICE_ROLE_KEY (already set for chat.ts / check-inactive.ts)
//
// CRON_SECRET must already be set (same as check-inactive.ts) — this route
// checks it to make sure only Vercel's own scheduler can trigger it.

export const config = { runtime: 'edge' };

const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
  const fetchErrors: Record<string, string> = {};

  // All three run independently — a timeout or failure on one never blocks
  // the others. Promise.allSettled (not sequential awaits) so they also run
  // in parallel rather than one after another, keeping total time down.
  const [vixResult, sp500Result, goldResult] = await Promise.allSettled([
    // VIX
    (async () => {
      const res = await fetchWithTimeout('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv');
      const text = await res.text();
      const rows = text.trim().split('\n').slice(1).filter(Boolean);
      const value = parseFloat(rows[rows.length - 1].split(',')[4]);
      if (!Number.isFinite(value)) throw new Error('parsed value was not a finite number');
      return value;
    })(),
    // S&P 500 — Yahoo Finance's chart API (the same endpoint that powers
    // their live website). Unofficial (not a published Yahoo product) but
    // widely used in production by tools like yfinance, and a genuinely
    // different infrastructure profile than the two previous attempts
    // (Stooq: blocks automated requests; FRED: times out specifically from
    // Vercel's network despite working everywhere else) — this is a
    // real-time production endpoint built for scale, not an archive/CSV
    // service. previousClose is given directly, no historical parsing needed.
    (async () => {
      const res = await fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC');
      const json = await res.json();
      const meta = json?.chart?.result?.[0]?.meta;
      const value = Number(meta?.regularMarketPrice);
      if (!Number.isFinite(value)) throw new Error(`no usable price in Yahoo response: ${JSON.stringify(json).slice(0, 300)}`);
      return value;
    })(),
    // Gold
    (async () => {
      const res = await fetchWithTimeout('https://api.gold-api.com/price/XAU');
      const json = await res.json();
      const value = Number(json.price ?? json.price_usd ?? json.value ?? json.rate);
      if (!Number.isFinite(value)) throw new Error(`no usable price field in response: ${JSON.stringify(json)}`);
      return value;
    })(),
  ]);

  if (vixResult.status === 'fulfilled') row.vix = vixResult.value;
  else fetchErrors.vix = vixResult.reason?.name === 'AbortError' ? 'timed out after 8s' : String(vixResult.reason?.message || vixResult.reason);

  if (sp500Result.status === 'fulfilled') row.sp500 = sp500Result.value;
  else fetchErrors.sp500 = sp500Result.reason?.name === 'AbortError' ? 'timed out after 8s' : String(sp500Result.reason?.message || sp500Result.reason);

  if (goldResult.status === 'fulfilled') row.gold = goldResult.value;
  else fetchErrors.gold = goldResult.reason?.name === 'AbortError' ? 'timed out after 8s' : String(goldResult.reason?.message || goldResult.reason);

  // Printed here (in addition to being in the JSON response) specifically so
  // this shows up directly in Vercel's Logs tab as plain readable text —
  // easier to find than digging through a response-body viewer.
  console.log('log-market-history result:', JSON.stringify({ row, fetchErrors }));

  if (row.vix === undefined && row.gold === undefined && row.sp500 === undefined) {
    return new Response(JSON.stringify({ logged: false, reason: 'all fetches failed', fetchErrors }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const upsertRes = await fetch(`${supabaseUrl}/rest/v1/market_history?on_conflict=date`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(row),
  });

  if (!upsertRes.ok) {
    const supabaseError = await upsertRes.text();
    console.log('log-market-history Supabase write FAILED:', upsertRes.status, supabaseError);
    return new Response(
      JSON.stringify({ logged: false, attempted: row, fetchErrors, supabaseStatus: upsertRes.status, supabaseError }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const saved = await upsertRes.json();
  console.log('log-market-history Supabase write SUCCEEDED:', JSON.stringify(saved));
  return new Response(JSON.stringify({ logged: true, saved, fetchErrors }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
