// Vercel Edge Function: /api/chat
// Proxies CFO Chat requests to Anthropic's Messages API, keeping the
// ANTHROPIC_API_KEY server-side (never exposed to the browser).
//
// Also enforces per-user rate limits:
//   - 100 messages per calendar month
//   - 20 messages per rolling 60 seconds (burst protection)
//
// Reliability: the two limit checks run in parallel (not one after another)
// and each has a short timeout. If Supabase is slow or unreachable for any
// reason, the message is let through rather than blocked ("fail open") —
// a brief Supabase hiccup should never break the CFO chat for the user.
// Logging the message (for future limit checks) happens in the background
// and does not delay the reply from Claude.
//
// Set these in Vercel Project Settings -> Environment Variables:
//   ANTHROPIC_API_KEY
//   SUPABASE_URL              (same value as VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY (from Supabase: Project Settings -> API -> service_role key)

export const config = { runtime: 'edge' };

const MONTHLY_LIMIT = 200;
const BURST_LIMIT = 20;
const BURST_WINDOW_SECONDS = 60;
const CHECK_TIMEOUT_MS = 2500; // how long we'll wait on Supabase before giving up and letting the message through

async function supabaseFetch(path: string, init: RequestInit, timeoutMs = CHECK_TIMEOUT_MS) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${url}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...init.headers,
        apikey: key!,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

// Returns the row count for a rate-limit check, or null if the check
// couldn't be completed (network issue, timeout, Supabase error, etc).
// null is treated by the caller as "unknown — let it through".
async function getUsageCount(userId: string, sinceIso: string): Promise<number | null> {
  try {
    const res = await supabaseFetch(
      `/rest/v1/chat_usage?user_id=eq.${userId}&created_at=gte.${sinceIso}&select=id`,
      { method: 'GET', headers: { Prefer: 'count=exact' } }
    );
    if (!res.ok) return null;
    const count = parseInt(res.headers.get('content-range')?.split('/')[1] || '', 10);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null; // timeout, network error, etc — fail open
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Server is missing ANTHROPIC_API_KEY. Add it in Vercel Project Settings > Environment Variables and redeploy.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const bodyJson = await req.json();
  const userId = bodyJson.user_id;
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Missing user_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Rate limiting is best-effort: if Supabase isn't configured or is having
  // a moment, we skip straight to Claude rather than blocking the user.
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const now = new Date();
    const burstSince = new Date(now.getTime() - BURST_WINDOW_SECONDS * 1000).toISOString();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    // Both checks run at the same time instead of one after another.
    const [burstCount, monthCount] = await Promise.all([
      getUsageCount(userId, burstSince),
      getUsageCount(userId, monthStart),
    ]);

    if (burstCount !== null && burstCount >= BURST_LIMIT) {
      return new Response(
        JSON.stringify({ error: 'rate_limited', reason: 'burst', message: "You're sending messages too quickly. Please wait a moment and try again." }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (monthCount !== null && monthCount >= MONTHLY_LIMIT) {
      return new Response(
        JSON.stringify({ error: 'rate_limited', reason: 'monthly', message: "You've reached your monthly message limit. It will reset at the start of next month." }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Log this message in the background — we do NOT wait for this to
    // finish before talking to Claude, so it never adds to response time.
    supabaseFetch('/rest/v1/chat_usage', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: userId }),
    }).catch(() => { /* best-effort logging — a missed log just means a slightly generous count next time */ });
  }

  // --- Forward to Anthropic (strip user_id first, Anthropic doesn't need it) ---
  const { user_id, ...anthropicBody } = bodyJson;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(anthropicBody),
  });

  // Pass the (streamed) response straight through to the client.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
    },
  });
}
