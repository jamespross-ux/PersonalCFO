// Vercel Edge Function: /api/market-data
// Proxies VIX and put/call ratio from CBOE's CSV feeds. These are fetched
// server-side and parsed here, then returned as clean JSON, because CBOE's
// CDN does not allow direct browser-to-CBOE requests (no CORS headers) —
// confirmed by the chips silently not appearing when fetched directly from
// the browser. No API key needed for either source; both are public data.
//
// Gold is NOT proxied here — gold-api.com already works fine as a direct
// browser fetch (CORS enabled on their side), so it stays as-is in App.tsx.
//
// Fails gracefully per-indicator: if one source's fetch or parsing fails,
// that key is simply omitted from the response rather than erroring the
// whole request, so the dashboard can still show whichever indicators did
// succeed.

export const config = { runtime: 'edge' };

export default async function handler(): Promise<Response> {
  const result: { vix?: { value: number; up: boolean }; putCall?: { value: number; up: boolean } } = {};

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
  } catch (e) {
    // omit vix from the response
  }

  // Put/Call ratio — a couple of header/description lines before the real
  // CSV header ("Trade_date,Call,Put,Total,P/C Ratio").
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
  } catch (e) {
    // omit putCall from the response
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Cache for 30 minutes at the edge — this data only updates once a
      // day at CBOE's end, so no need to hit their servers on every single
      // dashboard load from every user.
      'Cache-Control': 'public, max-age=0, s-maxage=1800',
    },
  });
}
