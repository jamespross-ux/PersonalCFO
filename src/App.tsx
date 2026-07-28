import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Area,
} from 'recharts';
import {
  LayoutDashboard, MessageCircle, NotebookPen, Settings2, Send, Plus, Trash2,
  ChevronDown, ChevronUp, Sparkles, Copy, Check, Paperclip, X, FileText,
  Eye, EyeOff, LogOut, Download, Info,
} from 'lucide-react';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const STORAGE_KEY = 'personal-cfo-data';
const MAX_HISTORY_MESSAGES = 24;

const seed = {
  baseCurrency: 'AED',
  secondaryCurrency: 'AED',
  displayCurrency: 'USD',
  displaySecondaryCurrency: 'AED',
  showSecondaryCurrency: true,
  disclaimerAccepted: false,
  lastFxAutoRefresh: null,
  loginStreak: { count: 0, lastDate: null, longest: 0 },
  insightSuppressedUntil: 0,
  fxRates: { GBP: 4.924, USD: 3.6725 },

  accounts: [
    { id: 'acc1', name: 'Your current account', type: 'asset', currency: 'AED' },
    { id: 'acc2', name: 'Your savings account', type: 'asset', currency: 'AED' },
  ],

  portfolio: [
    { id: 'p1', product: 'Your investment portfolio', country: '', currency: 'AED', risk: 'Balanced' },
    { id: 'p2', product: 'Pension / 401k / EOS', country: '', currency: 'AED', risk: 'Low', illiquid: true },
    { id: 'p3', product: 'Your property equity', country: '', currency: 'AED', risk: 'Low', illiquid: true },
  ],

  goals: [],

  recurringItems: [
    { id: 'r-savings', name: 'Monthly savings transfer', amount: 0, currency: 'AED', frequency: 'monthly', direction: 'out', account: 'Your savings account', category: 'Savings' },
  ],

  snapshots: [
    {
      id: 's1',
      date: new Date().toISOString().slice(0, 10),
      balances: { acc1: 0, acc2: 0 },
      portfolioValues: { p1: 0, p2: 0, p3: 0 },
      fxRates: { GBP: 4.924, USD: 3.6725 },
      note: 'Starter template — enter your real balances via Update, or paste an exported JSON backup via Setup.',
      netRecurring: { in: 0, out: 0 },
    },
  ],

  lifeLog: [],

  chat: [
    {
      role: 'assistant',
      content:
        "## Welcome to your HayaCFO\n\nThis is a starter template — no real data is loaded yet.\n\nGo to **Update** to enter your account balances, portfolio values, and recurring income/outflows, or use **Setup** to paste in a previously exported JSON backup.\n\nOnce your numbers are in, ask me anything — I can review your position, talk through your risk allocation, or help with planning.",
    },
  ],
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const CURRENCY_SYMBOLS = { GBP: '£', USD: '$', EUR: '€', AED: 'AED ', INR: '₹', SGD: 'S$', CAD: 'C$', AUD: 'A$', SAR: 'SAR ', QAR: 'QAR ', CHF: 'CHF ', JPY: '¥', HKD: 'HK$', NZD: 'NZ$', ZAR: 'R' };
const fmt = (n, currency) => {
  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
  return `${symbol}${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const DEFAULT_DISPLAY = 'GBP';
const DEFAULT_DISPLAY_SECONDARY = 'AED';

const fmtGBP = (amountBase, fxRates, displayCurrency = DEFAULT_DISPLAY) => {
  const rate = fxRates?.[displayCurrency] || 1;
  const val = Number(amountBase || 0) / rate;
  return fmt(val, displayCurrency);
};
const fmtGBPAED = (amountBase, fxRates, displayCurrency = DEFAULT_DISPLAY, displaySecondary = DEFAULT_DISPLAY_SECONDARY) => {
  const secVal = displaySecondary === 'AED'
    ? Number(amountBase || 0)
    : Number(amountBase || 0) / (fxRates?.[displaySecondary] || 1);
  return `${fmtGBP(amountBase, fxRates, displayCurrency)} (${fmt(secVal, displaySecondary)})`;
};

const rateFor = (currency, snapFx, dataFx, base) => {
  if (currency === base) return 1;
  const fromSnap = Number(snapFx?.[currency]);
  if (Number.isFinite(fromSnap) && fromSnap > 0) return fromSnap;
  const fromDefaults = Number(dataFx?.[currency]);
  if (Number.isFinite(fromDefaults) && fromDefaults > 0) return fromDefaults;
  return 1; // never return NaN/Infinity — a bad saved rate should fall back safely, not corrupt every total that uses it
};

const accountsTotal = (snap, accounts, dataFx, base) =>
  accounts.reduce((sum, a) => {
    const bal = Number(snap?.balances?.[a.id]) || 0;
    const rate = rateFor(a.currency || base, snap?.fxRates, dataFx, base);
    return sum + bal * rate * (a.type === 'liability' ? -1 : 1);
  }, 0);

const portfolioTotal = (snap, portfolio, dataFx, base, opts = {}) =>
  portfolio
    .filter((h) => (opts.illiquidOnly ? !!h.illiquid : opts.excludeIlliquid ? !h.illiquid : true))
    .reduce(
      (sum, h) => sum + (Number(snap?.portfolioValues?.[h.id]) || 0) * rateFor(h.currency, snap?.fxRates, dataFx, base),
      0
    );

const liquidNetWorth = (snap, accounts, portfolio, dataFx, base) =>
  accountsTotal(snap, accounts, dataFx, base) + portfolioTotal(snap, portfolio, dataFx, base, { excludeIlliquid: true });

const riskBreakdown = (snap, portfolio, dataFx, base) => {
  const result = { Low: 0, Balanced: 0, High: 0 };
  portfolio.filter((h) => !h.illiquid).forEach((h) => {
    const val = (Number(snap?.portfolioValues?.[h.id]) || 0) * rateFor(h.currency, snap?.fxRates, dataFx, base);
    result[h.risk] = (result[h.risk] || 0) + val;
  });
  return result;
};

// ── Net Worth Projection ────────────────────────────────────────────────────
// Projects TOTAL net worth (cash + liquid portfolio + illiquid assets) forward
// 5 years. Mid line: each risk bucket (Low/Balanced/High) compounds at its own
// assumed annual return. Cash grows only from monthly surplus (income - outflows),
// no interest assumed. Income is assumed to grow 4%/yr (salary growth), outflows
// 3%/yr (inflation). Illiquid assets (property, pensions) grow at a single
// conservative 5%/yr assumption, compounded monthly, applied to the combined
// illiquid total (not split by asset type).
// Upper/lower band: a symmetric margin around the mid line that widens evenly
// over time — 0% today (today's number isn't uncertain) up to ±15% by year 5 —
// representing general forecast uncertainty rather than a specific scenario.
const PROJECTION_MONTHS = 60;
const PROJECTION_RATES = { Low: 0.03, Balanced: 0.07, High: 0.12 };
const ILLIQUID_GROWTH = 0.05;
const SALARY_GROWTH = 0.04;
const SPENDING_GROWTH = 0.03;
const PROJECTION_BAND_MAX_PCT = 0.15; // symmetric band width at the 5-year mark
const monthlyRate = (annual) => Math.pow(1 + annual, 1 / 12) - 1;

const projectNetWorth = (cashNow, riskNow, totalIn, totalOut, illiquidNow = 0) => {
  let cashMid = cashNow;
  let portMid = { ...riskNow };
  let illiquidMid = illiquidNow;
  const midRates = { Low: monthlyRate(PROJECTION_RATES.Low), Balanced: monthlyRate(PROJECTION_RATES.Balanced), High: monthlyRate(PROJECTION_RATES.High) };
  const illiquidMonthlyRate = monthlyRate(ILLIQUID_GROWTH);

  const points = [];
  const today = new Date();

  for (let m = 0; m <= PROJECTION_MONTHS; m++) {
    if (m > 0) {
      const yearIdx = Math.floor((m - 1) / 12);
      const monthlyIncome = totalIn * Math.pow(1 + SALARY_GROWTH, yearIdx);
      const monthlyOutflow = totalOut * Math.pow(1 + SPENDING_GROWTH, yearIdx);
      const surplus = monthlyIncome - monthlyOutflow;
      cashMid += surplus;

      portMid.Low = (portMid.Low || 0) * (1 + midRates.Low);
      portMid.Balanced = (portMid.Balanced || 0) * (1 + midRates.Balanced);
      portMid.High = (portMid.High || 0) * (1 + midRates.High);
      illiquidMid *= (1 + illiquidMonthlyRate);
    }
    const portMidTotal = (portMid.Low || 0) + (portMid.Balanced || 0) + (portMid.High || 0);
    const mid = cashMid + portMidTotal + illiquidMid;
    const bandPct = PROJECTION_BAND_MAX_PCT * (m / PROJECTION_MONTHS);
    const d = new Date(today.getFullYear(), today.getMonth() + m, 1);
    points.push({
      month: m,
      label: m % 12 === 0 ? String(d.getFullYear()) : '',
      mid: Math.round(mid),
      upper: Math.round(mid * (1 + bandPct)),
      lower: Math.round(mid * (1 - bandPct)),
    });
  }
  // lowerBandHeight/upperBandHeight are used to stack two differently-coloured
  // Areas on top of "lower" — grey below the mid line, green above it — so the
  // shaded region spans exactly [lower, upper] with a colour split at "mid".
  return points.map((p) => ({ ...p, lowerBandHeight: p.mid - p.lower, upperBandHeight: p.upper - p.mid }));
};

const monthlyInBase = (item, dataFx, base) => {
  const rate = rateFor(item.currency, null, dataFx, base);
  const mult = item.frequency === 'monthly' ? 1 : item.frequency === 'weekly' ? 4.333 : item.frequency === 'yearly' ? 1 / 12 : 1;
  return Number(item.amount || 0) * rate * mult;
};

// ── CFO Score ────────────────────────────────────────────────────────────────
// A 0–100 score reflecting overall financial health across four dimensions.
// Calibrated to be encouraging — a decent position scores 65–75, strong 80+.
// Minimum score of 35 when there's enough data so nobody feels immediately alarmed.

function calcCFOScore(cashNow, totalIn, totalOut, goals, liquidPortNow) {
  const hasCoreDta = totalIn > 0 && totalOut > 0;
  if (!hasCoreDta) return null; // not enough data yet

  // ── Dimension 1: Monthly surplus (35pts) ─────────────────
  let surplusScore = 0;
  const surplusPct = (totalIn - totalOut) / totalIn;
  if (surplusPct > 0.30)      surplusScore = 35;
  else if (surplusPct > 0.20) surplusScore = 30;
  else if (surplusPct > 0.10) surplusScore = 25;
  else if (surplusPct > 0.05) surplusScore = 20;
  else if (surplusPct > 0)    surplusScore = 15;
  else if (surplusPct > -0.05) surplusScore = 8;
  else                         surplusScore = 2;

  // ── Dimension 2: Combined liquidity buffer (30pts) ────────
  // Cash + liquid portfolio both count — investments are accessible
  // in an emergency (just a day or two slower than cash).
  // However, thin cash is still a real weakness — if cash alone is
  // under 1 month, we cap the buffer score even if combined is high.
  const combinedLiquidity = cashNow + liquidPortNow;
  const combinedMonths = totalOut > 0 ? combinedLiquidity / totalOut : 0;
  const cashMonths = totalOut > 0 ? cashNow / totalOut : 0;
  let bufferScore = 0;
  if (combinedMonths >= 12)     bufferScore = 26;
  else if (combinedMonths >= 6) bufferScore = 23;
  else if (combinedMonths >= 3) bufferScore = 19;
  else if (combinedMonths >= 2) bufferScore = 14;
  else if (combinedMonths >= 1) bufferScore = 10;
  else if (combinedMonths >= 0.5) bufferScore = 5;
  else                            bufferScore = 2;
  // Bonus pts for healthy actual cash (day-to-day buffer)
  if (cashMonths >= 3)      bufferScore = Math.min(30, bufferScore + 4);
  else if (cashMonths >= 1) bufferScore = Math.min(30, bufferScore + 2);
  // Cap if cash is very thin — thin cash is a real weakness regardless of portfolio
  if (cashMonths < 0.5)     bufferScore = Math.min(bufferScore, 14);
  else if (cashMonths < 1)  bufferScore = Math.min(bufferScore, 22);

  // ── Dimension 3: Goals progress (20pts) ──────────────────
  let goalsScore = 10; // neutral if no goals
  const activeGoals = (goals || []).filter((g) => g.target > 0);
  if (activeGoals.length > 0) {
    const avgPct = activeGoals.reduce((s, g) => s + Math.min(g.current / g.target, 1), 0) / activeGoals.length;
    if (avgPct >= 0.75)      goalsScore = 20;
    else if (avgPct >= 0.50) goalsScore = 16;
    else if (avgPct >= 0.25) goalsScore = 12;
    else if (avgPct >= 0.10) goalsScore = 8;
    else                      goalsScore = 4;
  }

  // ── Dimension 4: Liquid portfolio vs monthly income (15pts) ──
  let portfolioScore = 7; // neutral if no data
  if (totalIn > 0 && liquidPortNow > 0) {
    const portVsIncome = liquidPortNow / totalIn;
    if (portVsIncome >= 12)     portfolioScore = 15;
    else if (portVsIncome >= 8) portfolioScore = 13;
    else if (portVsIncome >= 4) portfolioScore = 11;
    else if (portVsIncome >= 2) portfolioScore = 8;
    else if (portVsIncome >= 1) portfolioScore = 5;
    else                         portfolioScore = 2;
  }

  const raw = surplusScore + bufferScore + goalsScore + portfolioScore;
  return Math.max(35, Math.min(100, Math.round(raw)));
}

// Returns the single most impactful action to improve the score
function getCFOScoreInsight(cashNow, totalIn, totalOut, goals, liquidPortNow, score, displayCurrency, fxRates) {
  if (!totalIn || !totalOut) return null;

  const surplusPct = (totalIn - totalOut) / totalIn;
  const combinedLiquidity = cashNow + liquidPortNow;
  const combinedMonths = totalOut > 0 ? combinedLiquidity / totalOut : 0;
  const cashMonths = totalOut > 0 ? cashNow / totalOut : 0;
  const portVsIncome = totalIn > 0 && liquidPortNow > 0 ? liquidPortNow / totalIn : 0;
  const activeGoals = (goals || []).filter((g) => g.target > 0);
  const avgGoalPct = activeGoals.length > 0
    ? activeGoals.reduce((s, g) => s + Math.min(g.current / g.target, 1), 0) / activeGoals.length
    : null;

  // Find weakest dimension and give one actionable sentence.
  // Combined liquidity (cash + liquid portfolio) is used for buffer assessment —
  // investments are accessible in an emergency, so a large portfolio offsets a
  // thin cash balance without requiring the user to hold idle cash unnecessarily.
  const rate = fxRates?.[displayCurrency] || 1;
  const fmt = (v) => `${displayCurrency === 'GBP' ? '£' : displayCurrency + ' '}${Math.round(v / rate).toLocaleString()}`;

  if (surplusPct < 0) {
    return `Your outflows currently exceed income — addressing this would have the biggest impact on your score and long-term financial health.`;
  }
  if (combinedMonths < 1) {
    // Very low combined liquidity — genuinely needs attention
    const needed = Math.max(0, totalOut * 3 - combinedLiquidity);
    return `Your total accessible liquidity (cash + investments) covers less than a month of outflows — building this up would significantly improve your score.`;
  }
  if (surplusPct < 0.05) {
    return `Your monthly surplus is very tight — even small reductions in outflows would strengthen your score and financial resilience.`;
  }
  if (cashMonths < 1 && combinedMonths >= 3) {
    // Good combined coverage but thin day-to-day cash
    return `Your investments provide strong overall security. Keeping around 1 month of outflows in cash (${fmt(totalOut)} approx) would add useful day-to-day flexibility.`;
  }
  if (combinedMonths < 3) {
    const needed = Math.max(0, totalOut * 3 - combinedLiquidity);
    return `Growing your combined liquidity (cash + investments) by ${fmt(needed)} to cover 3 months of outflows would move your score meaningfully.`;
  }
  if (avgGoalPct !== null && avgGoalPct < 0.25) {
    return `Your goals are in early stages — consistent contributions, however small, will improve this dimension steadily over time.`;
  }
  if (portVsIncome < 2) {
    const needed = Math.max(0, totalIn * 4 - liquidPortNow);
    return `Growing your liquid investments by ${fmt(needed)} to reach 4 months' income would lift your portfolio score.`;
  }
  return `Your finances are in good shape — keep maintaining your surplus and buffer to protect your score.`;
}


function buildSystemPrompt(data, marketData) {
  const { baseCurrency, displayCurrency = 'USD', displaySecondaryCurrency = 'AED', accounts, portfolio, goals, recurringItems, snapshots, lifeLog, fxRates } = data;
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];

  const cash = latest ? accountsTotal(latest, accounts, fxRates, baseCurrency) : 0;
  const liquidPort = latest ? portfolioTotal(latest, portfolio, fxRates, baseCurrency, { excludeIlliquid: true }) : 0;
  const illiquidPort = latest ? portfolioTotal(latest, portfolio, fxRates, baseCurrency, { illiquidOnly: true }) : 0;
  const port = liquidPort + illiquidPort;
  const liquidNw = cash + liquidPort;
  const nw = liquidNw + illiquidPort;
  const risk = latest ? riskBreakdown(latest, portfolio, fxRates, baseCurrency) : { Low: 0, Balanced: 0, High: 0 };

  const lines = [];
  lines.push(
    `You are the user's Personal CFO — an ongoing financial advisor with full visibility of their accounts, investments, recurring cash flows, goals, and life context. They'll talk to you periodically and update balances and life events over time.`
  );
  lines.push('');
  lines.push(
    `Be direct, concise, and specific to their actual numbers. Surface patterns, risks, and trade-offs honestly, including uncomfortable ones (concentration, FX exposure, a goal becoming unrealistic, a recurring outflow growing, etc.). For decisions, present 2-3 concrete options with trade-offs in neutral language ("Option A would mean..."), not "you should". This is not regulated financial advice and they know that — don't add disclaimers. Use short paragraphs, ## headers and bullet lists only where they aid clarity. No filler or generic platitudes.`
  );
  lines.push(
    `Note: only recent chat history is sent with each request (older turns are trimmed). Durable facts — decisions, plans, new goals, life events — won't persist in chat memory, so when something important like that comes up, suggest the user note it via Update or the life log so it's retained.`
  );
  lines.push(
    `Note: the user's preferred display currency is ${displayCurrency}. Lead with ${displayCurrency} figures in conversation, with ${baseCurrency} in brackets where helpful — using the FX rates above.`
  );
  lines.push('');
  lines.push(
    `You have access to a tool called add_life_log_entry. Use it to record meaningful life or financial events to the user's permanent life log — things like job changes, major decisions, big expenses, life events, or important context about their financial situation. When something worth logging comes up naturally in conversation, proactively offer: "Would you like me to add that to your life log?" Wait for explicit confirmation before calling the tool. Write entries as clean, neutral, third-person summaries. Do not log trivial messages, profanity, or anything that wouldn't belong in a professional financial record.`
  );
  lines.push('');
  lines.push(`=== CURRENT FINANCIAL POSITION (as of ${latest?.date || 'no snapshot yet'}) ===`);
  lines.push(`Base currency (data): ${baseCurrency}. Display: ${displayCurrency} headline, ${baseCurrency} in brackets. Key FX rates: ${Object.entries(fxRates || {}).map(([k,v]) => `1 ${k} = ${v} ${baseCurrency}`).join(', ')}.`);
  lines.push(`Liquid net worth: ${fmt(liquidNw, baseCurrency)} (cash/accounts ${fmt(cash, baseCurrency)}, liquid portfolio ${fmt(liquidPort, baseCurrency)}) — this is the headline figure on the dashboard.`);
  if (illiquidPort > 0) {
    lines.push(`Illiquid assets (excluded from the headline figure): ${fmt(illiquidPort, baseCurrency)}. Total net worth including these: ${fmt(nw, baseCurrency)}.`);
  }

  // Pre-computed display currency figures so the CFO works from the same numbers the user sees
  const dispRate = displayCurrency === baseCurrency ? 1 : (1 / ((fxRates || {})[displayCurrency] || 1));
  const fmtDisp = (v) => {
    const converted = v * dispRate;
    return `${displayCurrency} ${converted.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  };
  const prevSnap = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const prevCash = prevSnap ? accountsTotal(prevSnap, accounts, fxRates, baseCurrency) : null;
  const prevLiqPort = prevSnap ? portfolioTotal(prevSnap, portfolio, fxRates, baseCurrency, { excludeIlliquid: true }) : null;
  const prevLiqNw = prevCash !== null ? prevCash + prevLiqPort : null;
  const delta = prevLiqNw !== null ? liquidNw - prevLiqNw : null;
  const snap7 = sorted.length >= 7 ? sorted[sorted.length - 7] : null;
  const snap30 = sorted.length >= 30 ? sorted[sorted.length - 30] : null;
  const liqNw7 = snap7 ? accountsTotal(snap7, accounts, fxRates, baseCurrency) + portfolioTotal(snap7, portfolio, fxRates, baseCurrency, { excludeIlliquid: true }) : null;
  const liqNw30 = snap30 ? accountsTotal(snap30, accounts, fxRates, baseCurrency) + portfolioTotal(snap30, portfolio, fxRates, baseCurrency, { excludeIlliquid: true }) : null;

  lines.push('');
  lines.push(`=== DISPLAY CURRENCY FIGURES (what the user sees on their dashboard in ${displayCurrency}) ===`);
  lines.push(`Liquid net worth: ${fmtDisp(liquidNw)}`);
  lines.push(`Cash: ${fmtDisp(cash)}`);
  lines.push(`Liquid portfolio: ${fmtDisp(liquidPort)}`);
  if (illiquidPort > 0) lines.push(`Illiquid assets: ${fmtDisp(illiquidPort)}`);
  lines.push(`Total net worth (incl. illiquid): ${fmtDisp(nw)}`);
  if (delta !== null) lines.push(`Since last update: ${delta >= 0 ? '+' : ''}${fmtDisp(delta)}`);
  if (liqNw7 !== null) lines.push(`7-day change: ${liquidNw - liqNw7 >= 0 ? '+' : ''}${fmtDisp(liquidNw - liqNw7)}`);
  if (liqNw30 !== null) lines.push(`30-day change: ${liquidNw - liqNw30 >= 0 ? '+' : ''}${fmtDisp(liquidNw - liqNw30)}`);
  lines.push(`When the user references figures like "${fmtDisp(liquidNw)}" or "${delta !== null ? fmtDisp(Math.abs(delta)) : 'a delta'}", these are the numbers they're looking at. Use these ${displayCurrency} figures naturally in conversation.`);
  lines.push('');
  lines.push('Accounts:');
  accounts.forEach((a) => {
    const bal = Number(latest?.balances?.[a.id]) || 0;
    const converted = bal * rateFor(a.currency, latest?.fxRates, fxRates, baseCurrency);
    lines.push(
      `- ${a.name} (${a.type}, ${a.currency}): ${a.currency} ${bal.toLocaleString()}${
        a.currency !== baseCurrency ? ` (≈ ${fmt(converted, baseCurrency)})` : ''
      }`
    );
  });
  lines.push('');
  lines.push('Portfolio holdings:');
  portfolio.forEach((h) => {
    const val = Number(latest?.portfolioValues?.[h.id]) || 0;
    const converted = val * rateFor(h.currency, latest?.fxRates, fxRates, baseCurrency);
    lines.push(
      `- ${h.product} (${h.country}, ${h.currency}, risk: ${h.risk}${h.illiquid ? ', ILLIQUID — excluded from headline figure' : ''}): ${h.currency} ${val.toLocaleString()}${
        h.currency !== baseCurrency ? ` (≈ ${fmt(converted, baseCurrency)})` : ''
      }`
    );
  });
  lines.push(
    `Risk allocation (liquid portfolio only): Low ${fmt(risk.Low, baseCurrency)}, Balanced ${fmt(risk.Balanced, baseCurrency)}, High ${fmt(
      risk.High,
      baseCurrency
    )} (of ${fmt(liquidPort, baseCurrency)} total)`
  );
  lines.push('');
  lines.push('=== RECURRING MONTHLY CASH FLOWS (from statement analysis) ===');
  const incomes = recurringItems.filter((r) => r.direction === 'in');
  const outflows = recurringItems.filter((r) => r.direction === 'out');
  const totalIn = incomes.reduce((s, r) => s + monthlyInBase(r, fxRates, baseCurrency), 0);
  const totalOut = outflows.reduce((s, r) => s + monthlyInBase(r, fxRates, baseCurrency), 0);
  lines.push('Income:');
  incomes.forEach((r) =>
    lines.push(`- ${r.name}: ${r.currency} ${Number(r.amount).toLocaleString()}/${r.frequency} (${r.account})${r.notes ? ` — ${r.notes}` : ''}`)
  );
  lines.push('Outflows:');
  outflows.forEach((r) =>
    lines.push(`- ${r.name}: ${r.currency} ${Number(r.amount).toLocaleString()}/${r.frequency} (${r.account}, ${r.category})${r.notes ? ` — ${r.notes}` : ''}`)
  );
  lines.push(`Net recurring position: ${fmt(totalIn - totalOut, baseCurrency)}/month (income ${fmt(totalIn, baseCurrency)}, outflows ${fmt(totalOut, baseCurrency)})`);
  lines.push(`IMPORTANT: the figures above (income, outflows, net) are the current, authoritative totals — always derive any net/balance figures directly from this income and outflow list, never by adjusting a net figure you or the user stated earlier in the conversation. If a line item changes, recompute from the full list above rather than doing delta arithmetic on a previous answer.`);
  lines.push('');
  lines.push('=== GOALS ===');
  goals.forEach((g) =>
    lines.push(
      `- ${g.name}: ${fmt(g.current, baseCurrency)} of ${fmt(g.target, baseCurrency)} target${g.targetDate ? `, target date ${g.targetDate}` : ''}`
    )
  );
  lines.push('');
  lines.push('=== SNAPSHOT HISTORY ===');
  sorted.forEach((s) => {
    const c = accountsTotal(s, accounts, fxRates, baseCurrency);
    const liqP = portfolioTotal(s, portfolio, fxRates, baseCurrency, { excludeIlliquid: true });
    const illiqP = portfolioTotal(s, portfolio, fxRates, baseCurrency, { illiquidOnly: true });
    const liqNw = c + liqP;
    const summary = illiqP > 0
      ? `liquid net worth ${fmt(liqNw, baseCurrency)} (cash ${fmt(c, baseCurrency)}, liquid portfolio ${fmt(liqP, baseCurrency)}; plus ${fmt(illiqP, baseCurrency)} illiquid)`
      : `net worth ${fmt(liqNw, baseCurrency)} (cash ${fmt(c, baseCurrency)}, portfolio ${fmt(liqP, baseCurrency)})`;
    lines.push(`- ${s.date}: ${summary}${s.note ? ` — ${s.note}` : ''}`);
  });
  if (lifeLog?.length) {
    lines.push('');
    lines.push('=== LIFE CONTEXT LOG (most recent first) ===');
    [...lifeLog].reverse().forEach((l) => lines.push(`- ${l.date}: ${l.text}`));
  }

  // CFO Score — calculated from four dimensions so the CFO can discuss it intelligently
  const scoreIncomes = (recurringItems || []).filter((r) => r.direction === 'in');
  const scoreOutflows = (recurringItems || []).filter((r) => r.direction === 'out');
  const tIn = scoreIncomes.reduce((s, r) => s + monthlyInBase(r, fxRates, baseCurrency), 0);
  const tOut = scoreOutflows.reduce((s, r) => s + monthlyInBase(r, fxRates, baseCurrency), 0);
  const latestSnap = sorted[sorted.length - 1];
  const cNow = latestSnap ? accountsTotal(latestSnap, accounts, fxRates, baseCurrency) : 0;
  const liqPortNow = latestSnap ? portfolioTotal(latestSnap, portfolio, fxRates, baseCurrency, { excludeIlliquid: true }) : 0;
  const score = calcCFOScore(cNow, tIn, tOut, goals, liqPortNow);
  if (score !== null && tOut > 0) {
    const combinedMonths = ((cNow + liqPortNow) / tOut).toFixed(1);
    const cashMonths = (cNow / tOut).toFixed(1);
    const surplusPct = tIn > 0 ? Math.round(((tIn - tOut) / tIn) * 100) : 0;
    const portVsIncome = tIn > 0 ? (liqPortNow / tIn).toFixed(1) : 0;
    const activeGoals = (goals || []).filter((g) => g.target > 0);
    const avgGoalPct = activeGoals.length > 0
      ? Math.round(activeGoals.reduce((s, g) => s + Math.min(g.current / g.target, 1), 0) / activeGoals.length * 100)
      : null;
    lines.push('');
    lines.push('=== CFO SCORE ===');
    lines.push(`Current score: ${score} / 100`);
    lines.push(`- Monthly surplus: ${surplusPct}% of income (35pts dimension)`);
    lines.push(`- Combined liquidity: ${combinedMonths} months of outflows covered by cash + liquid investments (${cashMonths} months in cash alone) (30pts dimension)`);
    lines.push(`- Goals progress: ${avgGoalPct !== null ? avgGoalPct + '% average across active goals' : 'no goals set'} (20pts dimension)`);
    lines.push(`- Portfolio vs income: ${portVsIncome} months of income invested in liquid portfolio (15pts dimension)`);
    lines.push(`The score is calculated automatically from the user's financial data. You can explain it, discuss what's driving it, and suggest what would move it higher. Be encouraging but honest.`);
  } else {
    lines.push('');
    lines.push('=== CFO SCORE ===');
    lines.push(`The CFO Score is not yet available. It is a financial health score out of 100, calculated across four dimensions: monthly surplus rate (35pts), liquidity in months of outflows (30pts), goals progress (20pts), and portfolio size relative to income (15pts). It requires both income and outflow items to be entered before it can be calculated. If the user asks why they don't have a score, explain this clearly and encourage them to add their recurring income and outflows in Setup.`);
  }

  // Net worth projection — dashboard chart the CFO should be able to explain and caveat
  const projRisk = latestSnap ? riskBreakdown(latestSnap, portfolio, fxRates, baseCurrency) : { Low: 0, Balanced: 0, High: 0 };
  if (latestSnap) {
    const projected = projectNetWorth(cNow, projRisk, tIn, tOut, illiquidPort);
    const final = projected[projected.length - 1];
    lines.push('');
    lines.push('=== TOTAL NET WORTH PROJECTION (dashboard chart) ===');
    lines.push(`The dashboard shows a 5-year TOTAL net worth projection: cash + liquid portfolio + illiquid assets (property, pension).`);
    lines.push(`Methodology: portfolio holdings grow at assumed annual rates by risk bucket — Low 3%, Balanced 7%, High 12% — compounded monthly, each bucket using its own actual current value (Low ${fmt(projRisk.Low, baseCurrency)}, Balanced ${fmt(projRisk.Balanced, baseCurrency)}, High ${fmt(projRisk.High, baseCurrency)}). Monthly income is assumed to grow 4%/year (salary growth), monthly outflows 3%/year (inflation), and the resulting surplus each month adds to cash with no interest assumed on cash itself. Illiquid assets (currently ${fmt(illiquidPort, baseCurrency)}, e.g. property and pensions) are assumed to grow at a single conservative 5%/year rate, compounded monthly, applied to the combined illiquid total — this is a simplification, not split by asset type, so it may understate a growth-invested pension or overstate flat property, depending on the actual mix.`);
    lines.push(`The shaded range is a general margin of uncertainty around the estimate, not a specific scenario — it starts at 0% today and widens evenly to ±15% by year 5, reflecting that longer-range projections are inherently less certain. It is not a statistical confidence interval and not tied to any specific best/worst-case assumption.`);
    lines.push(`In 5 years this projects to roughly ${fmt(final.mid, baseCurrency)} (estimate), with a shown range of roughly ${fmt(final.lower, baseCurrency)} to ${fmt(final.upper, baseCurrency)}.`);
    lines.push(`When asked about this chart, be direct about its limits: it assumes steady, uninterrupted growth in income, spending, and markets, which real life rarely delivers — job changes, market drawdowns, one-off expenses, or life events (a move, a career gap) would all knock it off track. A large share of the total may be illiquid (property/pension) — it's growing at an assumed 5%/year in this projection, but that's a single blended guess covering very different assets (e.g. property price growth vs invested pension returns), so it's worth pointing out if the user's illiquid mix is heavily weighted one way. It's a planning estimate, not a forecast or guarantee. If the user's situation includes anything you already know that would materially affect this (e.g. a known income gap, a big planned expense), point that out specifically rather than giving a generic disclaimer.`);
  }

  // Market context — VIX, gold, S&P 500, shown as small chips in the
  // dashboard header. Shared across all users (public market data, not
  // personal), logged once daily by a background job. Gives the CFO a real
  // multi-day trend to reference, not just today's snapshot.
  const hasCurrentMarketData = marketData && (marketData.vix || marketData.gold || marketData.sp500);
  const hasHistory = marketData && marketData.history && marketData.history.length > 0;
  if (hasCurrentMarketData || hasHistory) {
    lines.push('');
    lines.push('=== MARKET CONTEXT (dashboard header chips, shared across all users) ===');
    lines.push(`This is general market data, not personalised to the user, shown as three small indicators in the dashboard header: VIX (volatility/fear index), gold spot price (USD), and the S&P 500 index. Each is logged once daily.`);
    const streakNote = (s) => (s && s.streak >= 2 ? ` (${s.streak} consecutive ${s.up ? 'up' : 'down'} days)` : '');
    if (marketData.vix) lines.push(`VIX right now: ${marketData.vix.value.toFixed(1)}, ${marketData.vix.up ? 'up' : 'down'} vs the previous close${streakNote(marketData.vix)}.`);
    if (marketData.gold) lines.push(`Gold right now: $${Math.round(marketData.gold.value).toLocaleString()} (yesterday's close), ${marketData.gold.up ? 'up' : 'down'} vs the day before${streakNote(marketData.gold)}.`);
    if (marketData.sp500) lines.push(`S&P 500 right now: ${Math.round(marketData.sp500.value).toLocaleString()}, ${marketData.sp500.up ? 'up' : 'down'} vs the previous close${streakNote(marketData.sp500)}.`);

    if (hasHistory) {
      const h = marketData.history;
      const trendFor = (key) => {
        const vals = h.map((d) => d[key]).filter((v) => v !== null && v !== undefined);
        if (vals.length < 2) return null;
        const first = vals[0], last = vals[vals.length - 1];
        const min = Math.min(...vals), max = Math.max(...vals);
        const pctChange = first !== 0 ? (((last - first) / first) * 100).toFixed(1) : null;
        return { first, last, min, max, days: vals.length, pctChange };
      };
      const vixTrend = trendFor('vix');
      const goldTrend = trendFor('gold');
      const spTrend = trendFor('sp500');
      if (vixTrend) lines.push(`VIX trend over the last ${vixTrend.days} logged days: moved from ${vixTrend.first.toFixed(1)} to ${vixTrend.last.toFixed(1)} (${vixTrend.pctChange > 0 ? '+' : ''}${vixTrend.pctChange}%), ranging ${vixTrend.min.toFixed(1)}–${vixTrend.max.toFixed(1)}. Rising VIX = more fear/uncertainty; falling = calmer markets.`);
      if (goldTrend) lines.push(`Gold trend over the last ${goldTrend.days} logged days: moved from $${Math.round(goldTrend.first).toLocaleString()} to $${Math.round(goldTrend.last).toLocaleString()} (${goldTrend.pctChange > 0 ? '+' : ''}${goldTrend.pctChange}%), ranging $${Math.round(goldTrend.min).toLocaleString()}–$${Math.round(goldTrend.max).toLocaleString()}.`);
      if (spTrend) lines.push(`S&P 500 trend over the last ${spTrend.days} logged days: moved from ${Math.round(spTrend.first).toLocaleString()} to ${Math.round(spTrend.last).toLocaleString()} (${spTrend.pctChange > 0 ? '+' : ''}${spTrend.pctChange}%), ranging ${Math.round(spTrend.min).toLocaleString()}–${Math.round(spTrend.max).toLocaleString()}. Rising = bullish/positive market performance; falling = bearish.`);
    } else {
      lines.push(`No multi-day trend history logged yet — only today's snapshot is available so far. This will fill in day by day.`);
    }
    lines.push(`Use this as background colour when it's genuinely relevant (e.g. the user asks about markets, volatility, or timing an investment decision) — don't force it into unrelated conversations, and never use it to give specific trading or market-timing advice. This is context, not a signal to act on.`);
  }

  return lines.join('\n');
}

const readAsDataURL = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

const compressImage = (file, maxDimension = 1600, quality = 0.85) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => {
        let { width, height } = img;
        if (width <= maxDimension && height <= maxDimension) {
          resolve({ dataUrl: e.target.result, wasCompressed: false });
          return;
        }
        const scale = maxDimension / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ dataUrl, wasCompressed: true });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const readAsText = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsText(file);
  });

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const splitLine = (line) => {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur);
    return result;
  };
  const headers = splitLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = splitLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] ?? '').trim(); });
    return obj;
  });
}

function summarizeRows(rows) {
  if (!rows || rows.length === 0) return 'No rows found in file.';
  const columns = Object.keys(rows[0]);
  const numericTotals = {};
  columns.forEach((col) => {
    const nums = rows
      .map((r) => Number(String(r[col]).replace(/,/g, '')))
      .filter((n, i) => !Number.isNaN(n) && rows[i][col] !== '' && rows[i][col] !== undefined && rows[i][col] !== null);
    if (nums.length > rows.length * 0.5) {
      numericTotals[col] = nums.reduce((a, b) => a + b, 0);
    }
  });
  let out = `Rows: ${rows.length}\nColumns: ${columns.join(', ')}\n`;
  if (Object.keys(numericTotals).length) {
    out += `Column totals: ${Object.entries(numericTotals)
      .map(([k, v]) => `${k}=${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
      .join(', ')}\n`;
  }
  const MAX_ROWS_FULL = 800;
  const rowsToSend = rows.length > MAX_ROWS_FULL ? rows.slice(0, MAX_ROWS_FULL) : rows;
  out += `\nFull data (${rowsToSend.length}${rows.length > MAX_ROWS_FULL ? ` of ${rows.length} — truncated` : ''} rows, pipe-delimited):\n`;
  out += columns.join(' | ') + '\n';
  rowsToSend.forEach((r) => {
    out += columns.map((c) => r[c] ?? '').join(' | ') + '\n';
  });
  return out;
}

function renderMarkdown(text) {
  const blocks = [];
  let listBuffer = [];
  const flushList = (key) => {
    if (listBuffer.length) {
      blocks.push(
        <ul className="md-list" key={`l-${key}`}>
          {listBuffer.map((item, i) => (
            <li key={i}>{boldify(item)}</li>
          ))}
        </ul>
      );
      listBuffer = [];
    }
  };
  (text || '').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) {
      flushList(i);
      return;
    }
    if (line.startsWith('## ') || line.startsWith('### ')) {
      flushList(i);
      blocks.push(
        <h4 className="md-h" key={i}>
          {line.replace(/^#+\s*/, '')}
        </h4>
      );
    } else if (/^[-*]\s/.test(line)) {
      listBuffer.push(line.replace(/^[-*]\s/, ''));
    } else {
      flushList(i);
      blocks.push(
        <p className="md-p" key={i}>
          {boldify(line)}
        </p>
      );
    }
  });
  flushList('end');
  return blocks;
}

function boldify(line) {
  const parts = line.split(/\*\*(.*?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p));
}

function WatchDial({ percent, label, sub, accent }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent || 0));
  return (
    <div className="dial">
      <svg viewBox="0 0 100 100" width="110" height="110">
        {Array.from({ length: 12 }).map((_, i) => (
          <line key={i} x1="50" y1="6" x2="50" y2="12" stroke="#101C2E" strokeWidth="1.5" opacity="0.25" transform={`rotate(${i * 30} 50 50)`} />
        ))}
        <circle cx="50" cy="50" r={r} fill="none" stroke="#E4DCC8" strokeWidth="6" />
        <circle
          cx="50" cy="50" r={r} fill="none" stroke={accent} strokeWidth="6"
          strokeDasharray={`${(clamped / 100) * c} ${c}`}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="54" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="18" fontWeight="600" fill="#101C2E">
          {Math.round(clamped)}%
        </text>
      </svg>
      <div className="dial-label">{label}</div>
      {sub && <div className="dial-sub">{sub}</div>}
    </div>
  );
}

const RISK_COLORS = { Low: '#5E8C7C', Balanced: '#C9A24A', High: '#BD5B3A' };
// Colors for the stacked liquid net worth breakdown chart. No legend is shown
// (purely visual proportions), so these just need to read as distinct bands —
// "Other" is deliberately muted/light so it visually recedes as the catch-all.
const HOLDING_BAND_COLORS = ['#C9A24A', '#5E8C7C', '#4A7FA8', '#BD5B3A', '#8A93A3'];
const HOLDING_OTHER_COLOR = '#DCD6C8';

function RiskBar({ breakdown, total, currency, fmtDisplay }) {
  const order = ['Low', 'Balanced', 'High'];
  const fmtVal = fmtDisplay || ((v) => fmt(v, currency));
  return (
    <div>
      <div className="risk-bar">
        {order.map((r) => {
          const val = breakdown[r] || 0;
          const pct = total > 0 ? (val / total) * 100 : 0;
          if (pct <= 0) return null;
          return <div key={r} className="risk-bar-segment" style={{ width: `${pct}%`, background: RISK_COLORS[r] }} title={`${r}: ${fmtVal(val)}`} />;
        })}
      </div>
      <div className="risk-bar-legend">
        {order.map((r) => (
          <span className="risk-legend-item" key={r}>
            <span className="risk-dot" style={{ background: RISK_COLORS[r] }} />
            {r} {total > 0 ? Math.round(((breakdown[r] || 0) / total) * 100) : 0}% · {fmtVal(breakdown[r] || 0)}
          </span>
        ))}
      </div>
    </div>
  );
}

function makeUpdateForm(data) {
  const sorted = [...data.snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  return {
    date: new Date().toISOString().slice(0, 10),
    balances: latest ? { ...latest.balances } : {},
    portfolioValues: latest ? { ...latest.portfolioValues } : {},
    fxRates: { ...(data.fxRates || {}), ...(latest?.fxRates || {}) },
    lifeUpdate: '',
  };
}

const QUICK_PROMPTS = [
  'Review my current position and flag anything important.',
  'What should I do about my emergency fund?',
  'How exposed am I to GBP/USD vs my AED income?',
  "What's worth asking about my household bills and regular transfers?",
];

const INTERVIEW_PROMPT =
  "Based on everything you currently know about my accounts, portfolio, recurring cash flows, and goals — I'd like you to interview me with around 10 specific questions to help you understand my situation better and give sharper recommendations. Ground each question in my actual numbers and items where relevant (e.g. specific holdings, my goals) rather than generic finance questions. One question must always be included: 'Do you make any regular savings transfers or investments each month that aren't already listed as outflows? If so, we should add them to keep your surplus and CFO Score accurate.' Ask me one question at a time, number each one (e.g. \"Question 1 of 10:\"), wait for my answer, then ask the next — adapting each question based on what I've told you so far. After the final question, give a brief wrap-up summarising the key things you've learned, then proactively suggest any meaningful items worth adding to the life log based on what came up. Start with your first question now.";

export default function App() {
  const [session, setSession] = useState(undefined);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [inviteCode, setInviteCode] = useState('');

  const [data, setData] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState(null);
  const [updateForm, setUpdateForm] = useState(null);
  const [lifeNoteDraft, setLifeNoteDraft] = useState('');
  const [showAllLifeLog, setShowAllLifeLog] = useState(false);
  const [showAllRecurringDash, setShowAllRecurringDash] = useState(false);
  const [showAllPortfolioDash, setShowAllPortfolioDash] = useState(false);
  const [exportCopied, setExportCopied] = useState(false);
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState(null);
  const [showFigures, setShowFigures] = useState(true);
  const [showStreakPopover, setShowStreakPopover] = useState(false);
  const [showScorePopover, setShowScorePopover] = useState(false);
  const [showDatePopover, setShowDatePopover] = useState(false);
  const [fxLoading, setFxLoading] = useState(false);
  const [fxError, setFxError] = useState(null);
  const [displayFxLoading, setDisplayFxLoading] = useState(false);
  const [displayFxError, setDisplayFxError] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const [attachError, setAttachError] = useState(null);
  const [disclaimerChecked, setDisclaimerChecked] = useState(false);
  const [streakPercentile, setStreakPercentile] = useState(null);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const streakFetchedRef = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session ?? null);
      if (!session) { setData(null); setUpdateForm(null); }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data: rows } = await supabase
        .from('cfo_data')
        .select('data')
        .eq('user_id', session.user.id)
        .single();
      if (rows?.data) {
        setData({ ...seed, ...rows.data });
      } else {
        setData(seed);
      }
    })();
  }, [session]);

  useEffect(() => {
    if (data && !updateForm) setUpdateForm(makeUpdateForm(data));
  }, [data, updateForm]);

  useEffect(() => {
    if (tab === 'chat' && chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [tab, data?.chat?.length, chatLoading]);

  async function persist(newData) {
    setData(newData);
    if (!session) return;
    await supabase.from('cfo_data').upsert({
      user_id: session.user.id,
      data: newData,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  }

  // Daily auto-tracking (once per calendar day, silent, saves directly).
  // Instead of just refreshing rates on the existing latest entry, this creates
  // a NEW dated snapshot each day — carrying forward the last-known balances/
  // portfolio values/recurring figures, revalued at that day's live exchange
  // rate. This means "since last update" and the history charts reflect real
  // day-to-day movement even on days the user doesn't manually run an Update
  // (currency drift shows up on its own; a manual Update still always takes
  // precedence and safely merges into the same day's entry rather than
  // duplicating, via the existing date-based upsert in saveSnapshot).
  // History is capped at the most recent 90 days — anything older is purged
  // on each run so this can't grow indefinitely.
  const SNAPSHOT_RETENTION_DAYS = 90;
  useEffect(() => {
    if (!data || !data.disclaimerAccepted) return;
    const today = new Date().toISOString().slice(0, 10);
    if (data.lastFxAutoRefresh === today) return; // already ran today

    const base = data.baseCurrency;
    const fxCurrencies = [...new Set([
      ...(data.accounts || []).map((a) => a.currency),
      ...(data.portfolio || []).map((h) => h.currency),
      data.displayCurrency,
      data.displaySecondaryCurrency,
    ])].filter((c) => c && c !== base);

    const sorted = [...(data.snapshots || [])].sort((a, b) => a.date.localeCompare(b.date));
    const latestSnap = sorted[sorted.length - 1];
    if (!latestSnap) return; // nothing to carry forward yet — nothing to do

    (async () => {
      let updatedFxRates = { ...data.fxRates, ...latestSnap.fxRates };
      if (fxCurrencies.length > 0) {
        try {
          const apiKey = import.meta.env.VITE_EXCHANGERATE_API_KEY;
          const res = await fetch(`https://v6.exchangerate-api.com/v6/${apiKey}/latest/${base}`);
          const json = await res.json();
          if (json.result === 'success') {
            const rates = json.conversion_rates;
            fxCurrencies.forEach((c) => {
              if (rates[c]) updatedFxRates[c] = parseFloat((1 / rates[c]).toFixed(6));
            });
          }
        } catch (e) {
          // Fetch failed — fall through and still log today's entry using
          // whatever rates we already have, rather than skip the day entirely.
        }
      }

      // Carry today's entry forward from the latest known balances — a manual
      // Update on the same day will safely overwrite this via date matching.
      const todayEntry = {
        id: uid(),
        date: today,
        balances: { ...latestSnap.balances },
        portfolioValues: { ...latestSnap.portfolioValues },
        fxRates: updatedFxRates,
        note: '',
        netRecurring: latestSnap.netRecurring || { in: 0, out: 0 },
      };
      const existingIdx = sorted.findIndex((s) => s.date === today);
      let nextSnaps;
      if (existingIdx >= 0) {
        nextSnaps = [...sorted];
        nextSnaps[existingIdx] = { ...nextSnaps[existingIdx], fxRates: updatedFxRates };
      } else {
        nextSnaps = [...sorted, todayEntry];
      }

      // Purge anything older than the retention window.
      const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
      nextSnaps = nextSnaps.filter((s) => s.date >= cutoff);

      persist({ ...data, fxRates: updatedFxRates, lastFxAutoRefresh: today, snapshots: nextSnaps });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.lastFxAutoRefresh, data?.disclaimerAccepted]);

  // ── Market indicators (VIX, gold, S&P 500) ──────────────────────────────────
  // Purely decorative context in the hero header — fetched fresh on every page
  // load via our own /api/market-data proxy, cache: 'no-store' to force a
  // genuinely fresh fetch every time (after finding all three indicators
  // appeared frozen for days across two separate devices, every layer of
  // caching was removed rather than tuning a duration).
  //
  // Colour meaning is sentiment-based for VIX (a rising VIX is bearish = red;
  // falling is bullish = green). Gold and S&P 500 use plain price direction
  // (up = green, down = red) since a rising index or gold price is
  // straightforwardly good news, not a fear indicator.
  //
  // All three now behave consistently as "yesterday's close" — including
  // Gold, which used to show a live spot price; it's now sourced from our
  // own daily-logged history (market_history table) instead, same as VIX/S&P,
  // so the comparison basis is the same for all three.
  //
  // Each indicator also carries a "streak": how many consecutive logged days
  // it's moved in the same direction (e.g. down 3 days running).
  const [marketData, setMarketData] = useState({ vix: null, gold: null, sp500: null, history: null });
  useEffect(() => {
    if (!data || !data.disclaimerAccepted) return;

    (async () => {
      try {
        const res = await fetch('/api/market-data', { cache: 'no-store' });
        const json = await res.json();
        setMarketData({
          vix: json.vix || null,
          gold: json.gold || null,
          sp500: json.sp500 || null,
          history: json.history || null,
        });
      } catch (e) { /* chips just won't show */ }
    })();
  }, [data?.disclaimerAccepted]);

  // Login streak — counts distinct calendar days the app was opened (not strictly
  // consecutive sessions within a day, just whether a new day has occurred since
  // the last visit). Resets to 1 if a day is missed; tracks longest streak too.
  useEffect(() => {
    if (!data || !data.disclaimerAccepted) return;
    const today = new Date().toISOString().slice(0, 10);
    const streak = data.loginStreak || { count: 0, lastDate: null, longest: 0 };
    if (streak.lastDate === today) return; // already counted today

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const isConsecutive = streak.lastDate === yesterday;
    const newCount = isConsecutive ? streak.count + 1 : 1;
    const newLongest = Math.max(newCount, streak.longest || 0);

    persist({ ...data, loginStreak: { count: newCount, lastDate: today, longest: newLongest } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.disclaimerAccepted]);

  // Streak percentile — fetch once from streak_stats when user has 3+ day streak
  useEffect(() => {
    if (!data || !data.disclaimerAccepted) return;
    const userStreak = data.loginStreak?.count || 0;
    if (userStreak < 3 || streakFetchedRef.current) return;
    streakFetchedRef.current = true;
    (async () => {
      try {
        const { data: stats } = await supabase
          .from('streak_stats')
          .select('total_users, streak_distribution')
          .eq('id', 1)
          .single();
        if (!stats || !stats.streak_distribution || stats.total_users < 2) return;
        const dist = stats.streak_distribution;
        const belowOrEqual = Object.entries(dist)
          .filter(([k]) => parseInt(k) <= userStreak)
          .reduce((sum, [, v]) => sum + Number(v), 0);
        const percentile = Math.round(((stats.total_users - belowOrEqual) / stats.total_users) * 100);
        setStreakPercentile(Math.max(1, percentile));
      } catch (e) {
        // Silently fail
      }
    })();
  }, [data?.disclaimerAccepted, data?.loginStreak?.count]);

  const handleAuth = async () => {
    setAuthLoading(true);
    setAuthError(null);

    if (authMode === 'signup') {
      const code = inviteCode.trim();
      if (!code) {
        setAuthError('An invite code is required to create an account.');
        setAuthLoading(false);
        return;
      }
      const { data: codeRow, error: codeError } = await supabase
        .from('invite_codes')
        .select('id')
        .eq('code', code)
        .single();

      if (codeError || !codeRow) {
        setAuthError('Invalid invite code.');
        setAuthLoading(false);
        return;
      }

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email: authEmail, password: authPassword });
      if (signUpError) {
        setAuthError(signUpError.message);
        setAuthLoading(false);
        return;
      }

      const isGenuinelyNewUser = signUpData?.user && signUpData.user.identities && signUpData.user.identities.length > 0;
      if (!isGenuinelyNewUser) {
        setAuthError('That email is already registered. Try signing in instead, or use a different email.');
        setAuthLoading(false);
        return;
      }

      setAuthLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    setAuthLoading(false);
    if (error) setAuthError(error.message);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshFxRates = async () => {
    setFxLoading(true);
    setFxError(null);
    try {
      const apiKey = import.meta.env.VITE_EXCHANGERATE_API_KEY;
      const res = await fetch(`https://v6.exchangerate-api.com/v6/${apiKey}/latest/${baseCurrency}`);
      const json = await res.json();
      if (json.result !== 'success') throw new Error(json['error-type'] || 'Failed to fetch rates');
      const rates = json.conversion_rates;
      const updatedFxRates = { ...updateForm.fxRates };
      fxCurrencies.forEach((c) => {
        if (rates[c]) {
          updatedFxRates[c] = (1 / rates[c]).toFixed(6);
        }
      });
      setUpdateForm({ ...updateForm, fxRates: updatedFxRates });
    } catch (e) {
      setFxError('Could not fetch rates — check your connection and try again.');
    }
    setFxLoading(false);
  };

  // Fires the moment the person picks a new display currency in Setup, so the
  // dashboard is never silently showing a 1:1 "conversion" for a currency that
  // has never had a real rate fetched. Always fetches fresh (rather than only
  // when missing) so a stale cached rate also gets corrected. Safe merge only —
  // spreads the full data object and only adds/updates one key in fxRates,
  // never replaces accounts/portfolio/goals/life log or any other field.
  const handleDisplayCurrencyChange = async (newCurrency) => {
    persist({ ...data, displayCurrency: newCurrency }); // responsive UI immediately
    if (newCurrency === baseCurrency) return; // no conversion needed, nothing to fetch
    setDisplayFxLoading(true);
    setDisplayFxError(null);
    try {
      const apiKey = import.meta.env.VITE_EXCHANGERATE_API_KEY;
      const res = await fetch(`https://v6.exchangerate-api.com/v6/${apiKey}/latest/${baseCurrency}`);
      const json = await res.json();
      if (json.result !== 'success') throw new Error(json['error-type'] || 'Failed to fetch rate');
      const liveRate = json.conversion_rates?.[newCurrency];
      if (!liveRate) throw new Error(`No rate available for ${newCurrency}`);
      const updatedFxRates = { ...data.fxRates, [newCurrency]: parseFloat((1 / liveRate).toFixed(6)) };
      const sorted = [...(data.snapshots || [])].sort((a, b) => a.date.localeCompare(b.date));
      const latestSnap = sorted[sorted.length - 1];
      const updatedSnapshots = latestSnap
        ? data.snapshots.map((s) => (s.id === latestSnap.id ? { ...s, fxRates: updatedFxRates } : s))
        : data.snapshots;
      persist({ ...data, displayCurrency: newCurrency, fxRates: updatedFxRates, snapshots: updatedSnapshots });
    } catch (e) {
      setDisplayFxError(`Could not fetch a live rate for ${newCurrency} — figures may be inaccurate until this succeeds. Try again or check your connection.`);
    }
    setDisplayFxLoading(false);
  };

  if (session === undefined) {
    return (
      <div className="loading-screen">
        <style>{baseCSS}</style>
        Loading…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="cfo">
        <style>{baseCSS}</style>
        <div className="loading-screen" style={{ flexDirection: 'column', gap: 16, padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 4 }}>
            <svg width="24" height="24" viewBox="0 0 120 120" fill="none">
              <rect x="33" y="42" width="14" height="48" rx="1.5" fill="#101C2E"/>
              <rect x="73" y="30" width="14" height="60" rx="1.5" fill="#101C2E"/>
              <rect x="33" y="58" width="54" height="13" rx="1.5" fill="#101C2E"/>
              <rect x="73" y="30" width="14" height="13" rx="1.5" fill="#C9A24A"/>
            </svg>
            <span style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 18, fontWeight: 700, color: '#101C2E', letterSpacing: '-0.3px' }}>Haya<span style={{ color: '#C9A24A' }}>CFO</span></span>
          </div>
          <div style={{ fontFamily: 'IBM Plex Serif, serif', fontSize: 22, color: '#101C2E', textAlign: 'center' }}>
            {authMode === 'signin' ? 'Sign in to your CFO' : 'Create your account'}
          </div>
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
            style={{ maxWidth: 320, width: '100%' }}
          />
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
            style={{ maxWidth: 320, width: '100%' }}
          />
          {authMode === 'signup' && (
            <input
              className="input"
              type="text"
              placeholder="Invite code"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
              style={{ maxWidth: 320, width: '100%' }}
            />
          )}
          {authError && <p style={{ color: '#BD5B3A', fontSize: 12, margin: 0 }}>{authError}</p>}
          <button className="btn-primary" onClick={handleAuth} disabled={authLoading || !authEmail.trim() || !authPassword.trim() || (authMode === 'signup' && !inviteCode.trim())}>
            {authLoading ? '…' : authMode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <button className="btn-secondary" onClick={() => { setAuthMode(authMode === 'signin' ? 'signup' : 'signin'); setAuthError(null); setInviteCode(''); }}>
            {authMode === 'signin' ? 'First time? Create account' : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    );
  }

  if (!data || !updateForm) {
    return (
      <div className="loading-screen" style={{ background: '#101C2E', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <style>{baseCSS}</style>
        <svg width="48" height="48" viewBox="0 0 120 120" fill="none">
          <rect x="33" y="42" width="14" height="48" rx="1.5" fill="#F7F3EA"/>
          <rect x="73" y="30" width="14" height="60" rx="1.5" fill="#F7F3EA"/>
          <rect x="33" y="58" width="54" height="13" rx="1.5" fill="#F7F3EA"/>
          <rect x="73" y="30" width="14" height="13" rx="1.5" fill="#C9A24A"/>
        </svg>
        <div style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px', color: '#F7F3EA' }}>
          Haya<span style={{ color: '#C9A24A' }}>CFO</span>
        </div>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: '#7A8699' }}>
          Loading your CFO…
        </div>
      </div>
    );
  }

  if (!data.disclaimerAccepted) {
    return (
      <div className="cfo">
        <style>{baseCSS}</style>
        <div className="loading-screen" style={{ flexDirection: 'column', gap: 14, padding: 28, textAlign: 'left', alignItems: 'stretch' }}>
          <div style={{ maxWidth: 480, margin: '0 auto', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
              <svg width="22" height="22" viewBox="0 0 120 120" fill="none">
                <rect x="33" y="42" width="14" height="48" rx="1.5" fill="#101C2E"/>
                <rect x="73" y="30" width="14" height="60" rx="1.5" fill="#101C2E"/>
                <rect x="33" y="58" width="54" height="13" rx="1.5" fill="#101C2E"/>
                <rect x="73" y="30" width="14" height="13" rx="1.5" fill="#C9A24A"/>
              </svg>
              <span style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 18, fontWeight: 700, color: '#101C2E', letterSpacing: '-0.3px' }}>Haya<span style={{ color: '#C9A24A' }}>CFO</span></span>
            </div>
            <div style={{ fontFamily: 'IBM Plex Serif, serif', fontSize: 22, color: '#101C2E', textAlign: 'center', marginBottom: 16 }}>Before you continue</div>

            <p style={{ fontSize: 13, color: '#101C2E', lineHeight: 1.55 }}>
              This is a personal project I built myself, not a commercial product — please bear that in mind as you use it.
            </p>
            <p style={{ fontSize: 13, color: '#101C2E', lineHeight: 1.55 }}>
              Your data is private from other users, but as the project owner I technically have access to the underlying database, so please don't enter anything you wouldn't want me to potentially see. I won't go looking, but I want to be upfront that I could.
            </p>
            <p style={{ fontSize: 13, color: '#101C2E', lineHeight: 1.55 }}>
              I can't guarantee uptime, data persistence, or security to a professional standard — this is a side project, not a polished product. Use at your own discretion.
            </p>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 16, fontSize: 12.5, color: '#101C2E', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={disclaimerChecked}
                onChange={(e) => setDisclaimerChecked(e.target.checked)}
                style={{ marginTop: 3, cursor: 'pointer' }}
              />
              <span>I understand this and won't hold the creator responsible for any data loss, downtime, or other issues.</span>
            </label>

            <button
              className="btn-primary"
              onClick={() => persist({ ...data, disclaimerAccepted: true })}
              disabled={!disclaimerChecked}
              style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}
            >
              Continue to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { baseCurrency, displayCurrency = 'USD', displaySecondaryCurrency = 'AED', showSecondaryCurrency = true, accounts, portfolio, goals, recurringItems, snapshots, lifeLog, fxRates, chat } = data;

  const fmtD = (v) => fmtGBP(v, fxRates, displayCurrency);
  const fmtDS = (v) => fmtGBPAED(v, fxRates, displayCurrency, baseCurrency);
  const sortedSnaps = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sortedSnaps[sortedSnaps.length - 1];
  const previous = sortedSnaps[sortedSnaps.length - 2];

  const cashNow = latest ? accountsTotal(latest, accounts, fxRates, baseCurrency) : 0;
  const liquidPortNow = latest ? portfolioTotal(latest, portfolio, fxRates, baseCurrency, { excludeIlliquid: true }) : 0;
  const illiquidNow = latest ? portfolioTotal(latest, portfolio, fxRates, baseCurrency, { illiquidOnly: true }) : 0;
  const liquidNwNow = cashNow + liquidPortNow;
  const nwNow = liquidNwNow + illiquidNow;
  const nwPrev = previous ? liquidNetWorth(previous, accounts, portfolio, fxRates, baseCurrency) : null;
  const delta = nwPrev !== null ? liquidNwNow - nwPrev : null;
  const riskNow = latest ? riskBreakdown(latest, portfolio, fxRates, baseCurrency) : { Low: 0, Balanced: 0, High: 0 };

  const chartData = sortedSnaps.map((s) => ({
    date: s.date.slice(5),
    netWorth: liquidNetWorth(s, accounts, portfolio, fxRates, baseCurrency),
  }));

  // ── Liquid net worth breakdown (stacked by top 5 holdings + "Other") ──────
  // Ranks every liquid item (cash accounts + non-illiquid portfolio holdings)
  // by its CURRENT value, takes the top 5, and groups everything else into a
  // single "Other" band. Historical values per item come from each snapshot's
  // own saved balances/portfolioValues, so this is real history, not estimated.
  const liquidItems = [
    ...accounts.filter((a) => a.type !== 'liability').map((a) => ({ id: `acc:${a.id}`, kind: 'account', ref: a })),
    ...portfolio.filter((h) => !h.illiquid).map((h) => ({ id: `port:${h.id}`, kind: 'portfolio', ref: h })),
  ];
  const itemValueAt = (item, snap) => {
    if (!snap) return 0;
    const rate = rateFor(item.ref.currency || baseCurrency, snap.fxRates, fxRates, baseCurrency);
    return item.kind === 'account'
      ? (Number(snap.balances?.[item.ref.id]) || 0) * rate
      : (Number(snap.portfolioValues?.[item.ref.id]) || 0) * rate;
  };
  const topLiquidItems = [...liquidItems]
    .sort((a, b) => itemValueAt(b, latest) - itemValueAt(a, latest))
    .slice(0, 5);
  const holdingsChartData = sortedSnaps.map((s) => {
    const row = { date: s.date.slice(5) };
    let topSum = 0;
    topLiquidItems.forEach((item, i) => {
      const val = Math.max(0, itemValueAt(item, s));
      row[`h${i}`] = val;
      topSum += val;
    });
    row.other = Math.max(0, liquidNetWorth(s, accounts, portfolio, fxRates, baseCurrency) - topSum);
    row.total = topSum + row.other;
    return row;
  });

  const recurringChartData = sortedSnaps
    .filter((s) => s.netRecurring)
    .map((s) => ({
      date: s.date.slice(5),
      income: s.netRecurring.in,
      outflows: s.netRecurring.out,
      net: s.netRecurring.in - s.netRecurring.out,
    }));

  const fxCurrencies = [...new Set([
    ...accounts.map((a) => a.currency),
    ...portfolio.map((h) => h.currency),
    displayCurrency,
    displaySecondaryCurrency,
  ])].filter((c) => c && c !== baseCurrency);

  const incomeItems = recurringItems.filter((r) => r.direction === 'in');
  const outflowItems = recurringItems.filter((r) => r.direction === 'out');
  const totalIn = incomeItems.reduce((s, r) => s + monthlyInBase(r, fxRates, baseCurrency), 0);
  const totalOut = outflowItems.reduce((s, r) => s + monthlyInBase(r, fxRates, baseCurrency), 0);

  const projectionData = latest ? projectNetWorth(cashNow, riskNow, totalIn, totalOut, illiquidNow) : null;
  // "Nice numbers" tick generator so gridlines land on clean, evenly-spaced
  // values (e.g. 700k / 800k / 900k / 1000k) instead of Recharts' default
  // behaviour of forcing the raw domain max in as an uneven final tick.
  // The top of the domain is capped close to the actual highest value
  // (small pad only) rather than rounded up to the next full step, so there
  // isn't a large empty gap above the chart.
  const { domain: projectionDomain, ticks: projectionTicks } = projectionData ? (() => {
    const lows = projectionData.map((p) => p.lower);
    const highs = projectionData.map((p) => p.upper);
    const rawMin = Math.min(...lows), rawMax = Math.max(...highs);
    const pad = (rawMax - rawMin) * 0.08;
    const min = Math.max(0, rawMin - pad);
    const niceNum = (range, round) => {
      const exp = Math.floor(Math.log10(range));
      const frac = range / Math.pow(10, exp);
      let niceFrac;
      if (round) niceFrac = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
      else niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
      return niceFrac * Math.pow(10, exp);
    };
    const TICK_COUNT = 5;
    const step = niceNum((rawMax + pad - min) / (TICK_COUNT - 1), true);
    const niceMin = Math.floor(min / step) * step;
    const domainMax = rawMax + (rawMax - rawMin) * 0.03; // small headroom only, no step-rounding
    const ticks = [];
    for (let v = niceMin; v <= domainMax; v += step) ticks.push(Math.round(v));
    return { domain: [niceMin, domainMax], ticks };
  })() : { domain: [0, 0], ticks: [] };

  const projectionYearTicks = projectionData ? projectionData.filter((p) => p.label).map((p) => p.month) : [];
  const ProjectionTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const byKey = Object.fromEntries(payload.map((p) => [p.dataKey, p.value]));
    const rows = [
      byKey.upper !== undefined && { label: 'Upper range', value: byKey.upper },
      byKey.mid !== undefined && { label: 'Estimate', value: byKey.mid },
      byKey.lower !== undefined && { label: 'Lower range', value: byKey.lower },
    ].filter(Boolean);
    return (
      <div style={{ background: '#fff', border: '1px solid #E4DCC8', borderRadius: 4, padding: '8px 12px', fontFamily: 'IBM Plex Sans', fontSize: 12 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ color: r.label === 'Estimate' ? '#C9A24A' : '#5A6677' }}>{r.label}: {fmtD(r.value)}</div>
        ))}
      </div>
    );
  };

  const cfoScore = calcCFOScore(cashNow, totalIn, totalOut, goals, liquidPortNow);

  const LiquidBreakdownTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const rows = topLiquidItems.map((item, i) => ({
      name: item.kind === 'account' ? item.ref.name : item.ref.product,
      value: payload.find((p) => p.dataKey === `h${i}`)?.value || 0,
      color: HOLDING_BAND_COLORS[i],
    }));
    rows.push({ name: 'Other', value: payload.find((p) => p.dataKey === 'other')?.value || 0, color: HOLDING_OTHER_COLOR });
    return (
      <div style={{ background: '#fff', border: '1px solid #E4DCC8', borderRadius: 4, padding: '8px 12px', fontFamily: 'IBM Plex Sans', fontSize: 12, minWidth: 160 }}>
        <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, color: '#7A8699', marginBottom: 6 }}>{label}</div>
        {rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value).map((r) => (
          <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{r.name}</span>
            <span className="mono">{fmtD(r.value)}</span>
          </div>
        ))}
      </div>
    );
  };
  const cfoScoreInsight = cfoScore !== null
    ? getCFOScoreInsight(cashNow, totalIn, totalOut, goals, liquidPortNow, cfoScore, displayCurrency, fxRates)
    : null;

  // ── Insight Card ─────────────────────────────────────────────────────────
  const SUPPRESS_MS = 302400000; // 3.5 days
  const ROTATE_MS   = 302400000; // 3.5 days
  const monthlySurplusGBP = totalIn - totalOut;
  const insightSuppressedUntil = data.insightSuppressedUntil || 0;
  const hasIncome = recurringItems.some((r) => r.direction === 'in');
  const hasOutflows = recurringItems.some((r) => r.direction === 'out');
  const userStreak = data.loginStreak?.count || 0;
  const weekIndex = Math.floor(Date.now() / ROTATE_MS);
  const rawType = weekIndex % 3;
  let insightType = 'savings';
  if (rawType === 1) insightType = 'interest';
  if (rawType === 2 && userStreak >= 3 && streakPercentile !== null) insightType = 'streak';
  const insightValueGBP = insightType === 'savings' ? monthlySurplusGBP * 12 : monthlySurplusGBP * 0.33;
  const insightAmount = fmtD(insightValueGBP);
  const insightVisible = insightType === 'streak'
    ? Date.now() >= insightSuppressedUntil
    : hasIncome && hasOutflows && monthlySurplusGBP > 0 && Date.now() >= insightSuppressedUntil;
  const dismissInsight = () => persist({ ...data, insightSuppressedUntil: Date.now() + SUPPRESS_MS });
  // ─────────────────────────────────────────────────────────────────────────
  const addAccount = () => persist({ ...data, accounts: [...accounts, { id: uid(), name: 'New account', type: 'asset', currency: baseCurrency }] });
  const removeAccount = (id) => persist({ ...data, accounts: accounts.filter((a) => a.id !== id) });
  const updateAccount = (id, field, value) => persist({ ...data, accounts: accounts.map((a) => (a.id === id ? { ...a, [field]: value } : a)) });

  const updateHolding = (id, field, value) => persist({ ...data, portfolio: portfolio.map((h) => (h.id === id ? { ...h, [field]: value } : h)) });
  const addHolding = () => persist({ ...data, portfolio: [...portfolio, { id: uid(), product: 'New holding', country: '', currency: baseCurrency, risk: 'Balanced' }] });
  const removeHolding = (id) => persist({ ...data, portfolio: portfolio.filter((h) => h.id !== id) });

  const updateGoal = (id, field, value) => persist({ ...data, goals: goals.map((g) => (g.id === id ? { ...g, [field]: value } : g)) });
  const addGoal = () => persist({ ...data, goals: [...goals, { id: uid(), name: 'New goal', target: 0, current: 0, targetDate: '' }] });
  const removeGoal = (id) => persist({ ...data, goals: goals.filter((g) => g.id !== id) });

  const updateRecurring = (id, field, value) => persist({ ...data, recurringItems: recurringItems.map((r) => (r.id === id ? { ...r, [field]: value } : r)) });
  const addRecurring = () =>
    persist({ ...data, recurringItems: [...recurringItems, { id: uid(), name: 'New item', amount: 0, currency: baseCurrency, frequency: 'monthly', direction: 'out', account: accounts[0]?.name || '', category: '' }] });
  const removeRecurring = (id) => persist({ ...data, recurringItems: recurringItems.filter((r) => r.id !== id) });

  const removeLifeLogEntry = (id) => persist({ ...data, lifeLog: lifeLog.filter((l) => l.id !== id) });



  const exportData = () => {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `personal-cfo-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExportCopied(true);
    setTimeout(() => setExportCopied(false), 2000);
  };

  const importData = () => {
    try {
      const parsed = JSON.parse(importText);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.accounts)) {
        throw new Error('Missing expected fields');
      }
      const merged = { ...seed, ...parsed };
      persist(merged);
      setUpdateForm(makeUpdateForm(merged));
      setImportText('');
      setImportStatus('success');
      setTimeout(() => setImportStatus(null), 3000);
    } catch (e) {
      setImportStatus('error');
      setTimeout(() => setImportStatus(null), 3000);
    }
  };

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAttachError(null);
    const MAX_BYTES = 3.5 * 1024 * 1024;
    try {
      if (file.type.startsWith('image/')) {
        const { dataUrl, wasCompressed } = await compressImage(file);
        const base64 = dataUrl.split(',')[1];
        const approxBytes = base64.length * 0.75;
        if (approxBytes > MAX_BYTES) {
          setAttachError(`That image is still too large after compression (${(approxBytes / 1024 / 1024).toFixed(1)}MB). Try a screenshot instead, or a smaller photo.`);
          return;
        }
        setAttachment({ kind: 'image', name: file.name, mediaType: wasCompressed ? 'image/jpeg' : file.type, base64, dataUrl, wasCompressed });
      } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        if (file.size > MAX_BYTES) {
          setAttachError(`That PDF is ${(file.size / 1024 / 1024).toFixed(1)}MB — please use one under ~3.5MB, or paste the content into the main chat instead.`);
          return;
        }
        const dataUrl = await readAsDataURL(file);
        const base64 = dataUrl.split(',')[1];
        setAttachment({ kind: 'pdf', name: file.name, mediaType: 'application/pdf', base64 });
      } else if (file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv') {
        const text = await readAsText(file);
        const rows = parseCSV(text);
        setAttachment({ kind: 'data', name: file.name, summary: summarizeRows(rows) });
      } else if (/\.(xlsx|xls)$/i.test(file.name)) {
        setAttachError('Excel files aren\u2019t supported directly here — export as CSV (File \u2192 Export \u2192 CSV) and upload that instead.');
      } else {
        setAttachError('Unsupported file type — try an image, PDF, or CSV file.');
      }
    } catch (err) {
      setAttachError('Could not read that file.');
    }
  }

  const addStandaloneLifeNote = () => {
    if (!lifeNoteDraft.trim()) return;
    const entry = { id: uid(), date: new Date().toISOString().slice(0, 10), text: lifeNoteDraft.trim() };
    persist({ ...data, lifeLog: [...lifeLog, entry] });
    setLifeNoteDraft('');
  };

  const saveSnapshot = () => {
    const nextFx = { ...fxRates, ...Object.fromEntries(fxCurrencies.map((c) => [c, Number(updateForm.fxRates[c]) || 0])) };
    const cleanedSnap = {
      id: uid(),
      date: updateForm.date,
      balances: Object.fromEntries(accounts.map((a) => [a.id, Number(updateForm.balances[a.id]) || 0])),
      portfolioValues: Object.fromEntries(portfolio.map((h) => [h.id, Number(updateForm.portfolioValues[h.id]) || 0])),
      fxRates: Object.fromEntries(fxCurrencies.map((c) => [c, Number(updateForm.fxRates[c]) || 0])),
      note: updateForm.lifeUpdate || '',
      netRecurring: {
        in: incomeItems.reduce((s, r) => s + monthlyInBase(r, nextFx, baseCurrency), 0),
        out: outflowItems.reduce((s, r) => s + monthlyInBase(r, nextFx, baseCurrency), 0),
      },
    };
    const existingIdx = snapshots.findIndex((s) => s.date === cleanedSnap.date);
    let nextSnaps;
    if (existingIdx >= 0) {
      nextSnaps = [...snapshots];
      nextSnaps[existingIdx] = { ...nextSnaps[existingIdx], ...cleanedSnap, id: nextSnaps[existingIdx].id };
    } else {
      nextSnaps = [...snapshots, cleanedSnap];
    }
    let nextLifeLog = lifeLog;
    if (updateForm.lifeUpdate?.trim()) {
      nextLifeLog = [...lifeLog, { id: uid(), date: updateForm.date, text: updateForm.lifeUpdate.trim() }];
    }
    const nextData = { ...data, snapshots: nextSnaps, lifeLog: nextLifeLog, fxRates: nextFx };
    persist(nextData);
    setUpdateForm(makeUpdateForm(nextData));
    setTab('dashboard');
  };

  const clearChat = () => {
    persist({ ...data, chat: [
      { role: 'assistant', content: "Chat history cleared. I still have your full financial picture from your dashboard data — what would you like to know?" },
    ] });
  };

  // Tool definition — the CFO can call this to add an entry to the life log.
  // The CFO is instructed to ask the user first before calling it.
  const LIFE_LOG_TOOL = {
    name: 'add_life_log_entry',
    description: 'Add a meaningful life or financial event to the user\'s life log. Only call this after the user has explicitly confirmed they want it logged. Write a clean, neutral, third-person summary (e.g. "Accepted a new role at Company X"). Max 500 characters. Do not log trivial chat messages, profanity, or anything that wouldn\'t belong in a professional financial record. Decline if the log already has 100 or more entries.',
    input_schema: {
      type: 'object',
      properties: {
        entry: {
          type: 'string',
          description: 'The life log entry text. Neutral, third-person, factual summary. Max 500 characters.',
          maxLength: 500,
        },
      },
      required: ['entry'],
    },
  };

  async function sendChat(presetText) {
    const text = (presetText ?? chatInput).trim();
    if ((!text && !attachment) || chatLoading) return;

    let userContent;
    if (attachment?.kind === 'image') {
      userContent = [
        { type: 'image', source: { type: 'base64', media_type: attachment.mediaType, data: attachment.base64 } },
        { type: 'text', text: text || `I've attached an image (${attachment.name}). Please look at it and extract any relevant balance/account information.` },
      ];
    } else if (attachment?.kind === 'pdf') {
      userContent = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: attachment.base64 } },
        { type: 'text', text: text || `I've attached a PDF (${attachment.name}). Please review it and let me know what's relevant.` },
      ];
    } else if (attachment?.kind === 'data') {
      userContent = `${text ? text + '\n\n' : ''}[Attached file: ${attachment.name}]\n${attachment.summary}`;
    } else {
      userContent = text;
    }

    const nextChat = [...chat, { role: 'user', content: userContent }];
    persist({ ...data, chat: nextChat });
    setChatInput('');
    setAttachment(null);
    setChatLoading(true);
    setChatError(null);

    try {
      const firstUserIdx = nextChat.findIndex((m) => m.role === 'user');
      let apiMessages = nextChat.slice(firstUserIdx);
      if (apiMessages.length > MAX_HISTORY_MESSAGES) {
        apiMessages = apiMessages.slice(-MAX_HISTORY_MESSAGES);
        if (apiMessages[0]?.role !== 'user') apiMessages = apiMessages.slice(1);
      }

      // --- First API call (streaming) ---
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          stream: true,
          tools: [LIFE_LOG_TOOL],
          system: [{ type: 'text', text: buildSystemPrompt(data, marketData), cache_control: { type: 'ephemeral' } }],
          messages: apiMessages.map((m) => ({ role: m.role, content: m.content })),
          user_id: session.user.id,
        }),
      });

      if (response.status === 429) {
        const limitJson = await response.json().catch(() => null);
        throw new Error(limitJson?.message || "You've reached your message limit. Please try again later.");
      }
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`status ${response.status}: ${errText.slice(0, 200)}`);
      }
      if (!response.body) throw new Error('no response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let replyText = '';
      let streamErr = null;
      let toolUseBlock = null;
      let toolUseId = null;
      let currentBlockType = null;
      let toolInputJson = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (!dataStr) continue;
          let evt;
          try { evt = JSON.parse(dataStr); } catch { continue; }

          if (evt.type === 'content_block_start') {
            currentBlockType = evt.content_block?.type;
            if (currentBlockType === 'tool_use') {
              toolUseId = evt.content_block.id;
              toolUseBlock = { type: 'tool_use', id: toolUseId, name: evt.content_block.name, input: {} };
              toolInputJson = '';
            }
          } else if (evt.type === 'content_block_delta') {
            if (evt.delta?.type === 'text_delta') {
              replyText += evt.delta.text;
            } else if (evt.delta?.type === 'input_json_delta') {
              toolInputJson += evt.delta.partial_json;
            }
          } else if (evt.type === 'content_block_stop') {
            if (currentBlockType === 'tool_use' && toolInputJson) {
              try { toolUseBlock.input = JSON.parse(toolInputJson); } catch { /* ignore */ }
            }
          } else if (evt.type === 'error') {
            streamErr = evt.error?.message || 'stream error';
          }
        }
      }

      if (streamErr) throw new Error(streamErr);

      // --- Handle tool use ---
      if (toolUseBlock) {
        const entry = toolUseBlock.input?.entry?.slice(0, 500) || '';
        const currentLog = data.lifeLog || [];

        let toolResult;
        let confirmationMsg;

        let updatedData = data;

        if (currentLog.length >= 100) {
          toolResult = 'Error: Life log is full (100 entries). The user should remove some old entries in Setup before adding new ones.';
        } else if (!entry.trim()) {
          toolResult = 'Error: Entry text was empty — nothing was logged.';
        } else {
          // Execute the tool — add to life log.
          // We hoist newEntry and updatedData so the same object is used in both
          // the intermediate persist() and the final persist() — avoiding the
          // stale-closure bug where a second persist() would overwrite the entry.
          const newEntry = { id: uid(), date: new Date().toISOString().slice(0, 10), text: entry.trim() };
          updatedData = { ...data, lifeLog: [...currentLog, newEntry] };
          toolResult = `Success: Entry added to life log — "${entry.trim()}"`;
        }

        // --- Second API call (non-streaming) to get CFO's confirmation message ---
        const assistantToolMsg = {
          role: 'assistant',
          content: [
            ...(replyText ? [{ type: 'text', text: replyText }] : []),
            toolUseBlock,
          ],
        };
        const toolResultMsg = {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolUseId, content: toolResult }],
        };

        const confirmResponse = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 300,
            stream: false,
            tools: [LIFE_LOG_TOOL],
            system: [{ type: 'text', text: buildSystemPrompt(data, marketData), cache_control: { type: 'ephemeral' } }],
            messages: [
              ...apiMessages.map((m) => ({ role: m.role, content: m.content })),
              assistantToolMsg,
              toolResultMsg,
            ],
            user_id: session.user.id,
          }),
        });

        const confirmJson = await confirmResponse.json();
        const finalReply = confirmJson?.content?.find((b) => b.type === 'text')?.text?.trim()
          || (toolResult.startsWith('Success') ? '✓ Added to your life log.' : 'I wasn\'t able to add that — the life log may be full.');

        const fullReply = [replyText, finalReply].filter(Boolean).join('\n\n');

        // Use updatedData (which includes the new life log entry) as the base,
        // so the chat persist doesn't overwrite what we just saved.
        persist({ ...updatedData, chat: [...nextChat, { role: 'assistant', content: fullReply }] });
        return;
      }

      // --- Normal text response (no tool use) ---
      if (!replyText) throw new Error('empty response');
      persist({ ...data, chat: [...nextChat, { role: 'assistant', content: replyText }] });

    } catch (e) {
      const isLimitMessage = /message limit|too quickly/i.test(e.message || '');
      setChatError(isLimitMessage
        ? e.message
        : `Could not reach the CFO just now (${e.message || 'unknown error'}). Try again in a moment.`);
      persist({ ...data, chat: nextChat });
    } finally {
      setChatLoading(false);
    }
  }

  const TABS = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'chat', label: 'CFO Chat', icon: MessageCircle },
    { id: 'update', label: 'Update', icon: NotebookPen },
    { id: 'data', label: 'Setup', icon: Settings2 },
  ];

  return (
    <div className="cfo">
      <style>{baseCSS}</style>

      <header className="masthead">
        <div className="masthead-eyebrow" onClick={() => { setShowStreakPopover(false); setShowScorePopover(false); setShowDatePopover(false); }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="28" height="28" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
              <rect x="33" y="42" width="14" height="48" rx="1.5" fill="#F7F3EA"/>
              <rect x="73" y="30" width="14" height="60" rx="1.5" fill="#F7F3EA"/>
              <rect x="33" y="58" width="54" height="13" rx="1.5" fill="#F7F3EA"/>
              <rect x="73" y="30" width="14" height="13" rx="1.5" fill="#C9A24A"/>
            </svg>
            <span>Haya<span style={{ color: '#C9A24A' }}>CFO</span></span>
            {data.loginStreak?.count >= 2 && (
              <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <button
                  className="streak-badge"
                  style={{ background: 'rgba(201,162,74,0.18)', border: 'none', cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); setShowStreakPopover((v) => !v); setShowScorePopover(false); }}
                >
                  🔥 {data.loginStreak.count}
                </button>
                {showStreakPopover && (
                  <div className="streak-popover" onClick={(e) => e.stopPropagation()}>
                    <div className="streak-popover-title">Login Streak</div>
                    <p className="streak-popover-body">
                      {data.loginStreak.count} day streak —{' '}
                      {data.loginStreak.count >= 30
                        ? 'Outstanding consistency. Your CFO is well informed.'
                        : data.loginStreak.count >= 14
                        ? 'Two weeks strong — great financial habit building.'
                        : data.loginStreak.count >= 7
                        ? 'A full week in — good to see you staying on top of it.'
                        : 'Good to see you building the habit — keep it going.'}
                      {' '}{data.loginStreak.longest > data.loginStreak.count
                        ? `Longest streak: ${data.loginStreak.longest} days.`
                        : 'This is your best streak yet.'}
                    </p>
                  </div>
                )}
              </span>
            )}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {cfoScore !== null && (
              <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <button
                  className="cfo-score-btn"
                  onClick={(e) => { e.stopPropagation(); setShowScorePopover((v) => !v); setShowStreakPopover(false); }}
                >
                  CFO Score · {cfoScore}
                </button>
                {showScorePopover && (
                  <div className="score-popover" onClick={(e) => e.stopPropagation()}>
                    <div className="score-popover-title">CFO Score · {cfoScore} / 100</div>
                    <div className="score-bar-track">
                      <div className="score-bar-fill" style={{ width: `${cfoScore}%` }} />
                    </div>
                    {cfoScoreInsight && (
                      <p className="score-popover-body">{cfoScoreInsight}</p>
                    )}
                    <button
                      className="score-popover-cta"
                      onClick={() => {
                        setShowScorePopover(false);
                        setChatInput('Explain my CFO Score and how to improve it.');
                        setTab('chat');
                      }}
                    >
                      Ask your CFO →
                    </button>
                  </div>
                )}
              </span>
            )}
            <button
              className="masthead-eye-btn"
              onClick={() => setShowFigures((v) => !v)}
              title={showFigures ? 'Hide figures' : 'Show figures'}
            >
              {showFigures ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </span>
        </div>

        <div style={{ filter: showFigures ? 'none' : 'blur(8px)', userSelect: showFigures ? 'auto' : 'none', transition: 'filter 0.2s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="masthead-label">Your liquid net worth</div>
              <div className="masthead-hero">{fmtD(liquidNwNow)}</div>
            </div>
            {(marketData.vix || marketData.gold || marketData.sp500) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                {marketData.vix && (
                  <div className="market-chip">
                    <span className="market-chip-label">VIX</span>
                    <span className="market-chip-val">
                      {marketData.vix.value.toFixed(1)}{' '}
                      <span className={marketData.vix.up ? 'market-chip-bad' : 'market-chip-good'}>
                        {marketData.vix.up ? '▲' : '▼'}{marketData.vix.streak >= 2 ? marketData.vix.streak : ''}
                      </span>
                    </span>
                  </div>
                )}
                {marketData.gold && (
                  <div className="market-chip">
                    <span className="market-chip-label">GOLD</span>
                    <span className="market-chip-val">
                      ${Math.round(marketData.gold.value).toLocaleString()}{' '}
                      <span className={marketData.gold.up ? 'market-chip-good' : 'market-chip-bad'}>
                        {marketData.gold.up ? '▲' : '▼'}{marketData.gold.streak >= 2 ? marketData.gold.streak : ''}
                      </span>
                    </span>
                  </div>
                )}
                {marketData.sp500 && (
                  <div className="market-chip">
                    <span className="market-chip-label">S&amp;P</span>
                    <span className="market-chip-val">
                      {Math.round(marketData.sp500.value).toLocaleString()}{' '}
                      <span className={marketData.sp500.up ? 'market-chip-good' : 'market-chip-bad'}>
                        {marketData.sp500.up ? '▲' : '▼'}{marketData.sp500.streak >= 2 ? marketData.sp500.streak : ''}
                      </span>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="masthead-sub-row">
            {showSecondaryCurrency && <span className="masthead-secondary">{fmt(liquidNwNow, baseCurrency)}</span>}
            {delta !== null && (
              <span className={`masthead-delta ${delta >= 0 ? 'pos' : 'neg'}`}>
                {delta >= 0 ? '▲' : '▼'} {fmtD(Math.abs(delta))} since last update
              </span>
            )}
          </div>

          <div className="masthead-grid">
            <div className="masthead-cell">
              <div className="masthead-cell-label">Cash</div>
              <div className="masthead-cell-value">{fmtD(cashNow)}</div>
              {showSecondaryCurrency && <div className="masthead-cell-secondary">{fmt(cashNow, baseCurrency)}</div>}
            </div>
            <div className="masthead-cell">
              <div className="masthead-cell-label">Portfolio</div>
              <div className="masthead-cell-value">{fmtD(liquidPortNow)}</div>
              {showSecondaryCurrency && <div className="masthead-cell-secondary">{fmt(liquidPortNow, baseCurrency)}</div>}
            </div>
            {illiquidNow > 0 && (
              <div className="masthead-cell">
                <div className="masthead-cell-label">Illiquid</div>
                <div className="masthead-cell-value">{fmtD(illiquidNow)}</div>
                <div className="masthead-cell-secondary">
                  {portfolio.filter((h) => h.illiquid).map((h) => h.product).join(' · ')}
                </div>
              </div>
            )}
            <div className="masthead-cell masthead-cell-total">
              <div className="masthead-cell-label" style={{ color: '#C9A24A' }}>Total</div>
              <div className="masthead-cell-value">{fmtD(nwNow)}</div>
              {showSecondaryCurrency && <div className="masthead-cell-secondary">{fmt(nwNow, baseCurrency)}</div>}
            </div>
          </div>
        </div>

        <div className="masthead-date" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {latest ? `As of ${new Date(latest.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'No data yet'}
          <button
            onClick={(e) => { e.stopPropagation(); setShowDatePopover((v) => !v); setShowScorePopover(false); setShowStreakPopover(false); }}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', color: 'inherit', opacity: 0.7 }}
            aria-label="What does this date mean?"
          >
            <Info size={13} />
          </button>
          {showDatePopover && (
            <div className="score-popover" onClick={(e) => e.stopPropagation()} style={{ left: 0, right: 'auto', width: 220 }}>
              <p className="score-popover-body">Add new figures in the Update tab and tap "Save update" to see your new totals.</p>
            </div>
          )}
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <Icon size={15} />
              {t.label}
            </button>
          );
        })}
      </nav>

      <main className="content">
        {tab === 'dashboard' && (
          <div className="stack">

            {/* ── Insight of the Week card ── */}
            {insightVisible && (
              <div className="insight-card">
                <button className="insight-dismiss" onClick={dismissInsight} aria-label="Dismiss insight">✕</button>

                {/* Eyebrow */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: '#C9A24A', boxShadow: '0 0 0 3px rgba(201,162,74,0.18)', flexShrink: 0 }} />
                  <span style={{ fontFamily: "'JetBrains Mono', 'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '2.5px', color: '#C9A24A' }}>INSIGHT OF THE WEEK</span>
                </div>

                {/* Message */}
                {insightType === 'savings' ? (
                  <div style={{ fontFamily: "'Spectral', 'IBM Plex Serif', serif", fontSize: 18, lineHeight: 1.45, color: '#EEF1F5', paddingRight: 20 }}>
                    At your current surplus rate you'll have an extra{' '}
                    <span style={{ fontWeight: 700, color: '#D9B45F', whiteSpace: 'nowrap' }}>{insightAmount}</span>{' '}
                    in <span style={{ whiteSpace: 'nowrap' }}>12 months</span>.
                  </div>
                ) : insightType === 'interest' ? (
                  <div style={{ fontFamily: "'Spectral', 'IBM Plex Serif', serif", fontSize: 18, lineHeight: 1.45, color: '#EEF1F5', paddingRight: 20 }}>
                    Put your monthly surplus into a 6% savings plan and you'd earn{' '}
                    <span style={{ fontWeight: 700, color: '#D9B45F', whiteSpace: 'nowrap' }}>{insightAmount}</span>{' '}
                    in interest over <span style={{ whiteSpace: 'nowrap' }}>12 months</span>.
                  </div>
                ) : (
                  <div style={{ fontFamily: "'Spectral', 'IBM Plex Serif', serif", fontSize: 18, lineHeight: 1.45, color: '#EEF1F5', paddingRight: 20 }}>
                    With a <span style={{ fontWeight: 700, color: '#D9B45F', whiteSpace: 'nowrap' }}>{userStreak}-day streak</span>, you're in the top{' '}
                    <span style={{ fontWeight: 700, color: '#D9B45F', whiteSpace: 'nowrap' }}>{streakPercentile}%</span>{' '}
                    most consistent users on HayaCFO.
                  </div>
                )}

                {/* Footer */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                  <span style={{ width: 16, height: 16, borderRadius: 5, background: '#16283F', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#C9A24A', flexShrink: 0 }}>H</span>
                  <span style={{ fontFamily: "'JetBrains Mono', 'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '1.5px', color: '#5D708A' }}>FROM HAYACFO</span>
                </div>
              </div>
            )}

            {projectionData && (
              <div className="card">
                <div className="card-title">Your 5-year net worth projection</div>
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={projectionData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#E4DCC8" vertical={false} />
                    <XAxis dataKey="month" type="number" domain={[0, PROJECTION_MONTHS]} ticks={projectionYearTicks} tickFormatter={(m) => { const pt = projectionData.find((p) => p.month === m); return pt ? pt.label : ''; }} tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }} stroke="#7A8699" />
                    <YAxis domain={projectionDomain} ticks={projectionTicks} allowDataOverflow tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }} stroke="#7A8699" tickFormatter={(v) => { const rate = fxRates?.[displayCurrency] || 1; const symbol = CURRENCY_SYMBOLS[displayCurrency] || ''; const val = v / rate; return Math.abs(val) >= 1000000 ? `${symbol}${(val / 1000000).toFixed(1)}m` : `${symbol}${(val / 1000).toFixed(0)}k`; }} width={62} />
                    <Tooltip content={<ProjectionTooltip />} />
                    <Area type="monotone" dataKey="lower" stackId="band" stroke="none" fill="transparent" />
                    <Area type="monotone" dataKey="lowerBandHeight" stackId="band" stroke="none" fill="#8A93A3" fillOpacity={0.35} />
                    <Area type="monotone" dataKey="upperBandHeight" stackId="band" stroke="none" fill="#4F8C6E" fillOpacity={0.35} />
                    <Line type="monotone" dataKey="mid" stroke="#C9A24A" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="upper" stroke="#C9A24A" strokeWidth={0} dot={false} legendType="none" />
                  </ComposedChart>
                </ResponsiveContainer>
                <button
                  className="score-popover-cta"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    setChatInput('Briefly explain my 5 year total net worth projection.');
                    setTab('chat');
                  }}
                >
                  Ask your CFO →
                </button>
              </div>
            )}

            {sortedSnaps.length > 1 && (
              <div className="card">
                <div className="card-title">Your liquid net worth (cash + investments)</div>
                <ResponsiveContainer width="100%" height={160}>
                  <ComposedChart data={holdingsChartData}>
                    <CartesianGrid stroke="#E4DCC8" vertical={false} />
                    <XAxis dataKey="date" interval={holdingsChartData.length > 6 ? Math.ceil(holdingsChartData.length / 6) - 1 : 0} tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }} stroke="#7A8699" />
                    <YAxis tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }} stroke="#7A8699" tickFormatter={(v) => { const rate = fxRates?.[displayCurrency] || 1; const symbol = CURRENCY_SYMBOLS[displayCurrency] || ''; const val = v / rate; return Math.abs(val) >= 1000000 ? `${symbol}${(val / 1000000).toFixed(1)}m` : `${symbol}${(val / 1000).toFixed(0)}k`; }} width={62} />
                    <Tooltip content={<LiquidBreakdownTooltip />} />
                    {topLiquidItems.map((item, i) => (
                      <Area key={`h${i}`} type="monotone" dataKey={`h${i}`} stackId="liquid" stroke="none" fill={HOLDING_BAND_COLORS[i]} fillOpacity={0.88} />
                    ))}
                    <Area type="monotone" dataKey="other" stackId="liquid" stroke="none" fill={HOLDING_OTHER_COLOR} fillOpacity={0.88} />
                    <Line type="monotone" dataKey="total" stroke="#C9A24A" strokeWidth={2} strokeDasharray="4 3" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="card">
              <div className="card-title">Your monthly cash flow</div>
              <div className="stat-row">
                <div className="stat-card">
                  <div className="stat-label">Income</div>
                  <div className="stat-value pos">{fmtD(totalIn)}</div>
                  {showSecondaryCurrency && <div className="stat-sub">{fmt(totalIn, baseCurrency)}</div>}
                </div>
                <div className="stat-card">
                  <div className="stat-label">Outflows</div>
                  <div className="stat-value neg">{fmtD(totalOut)}</div>
                  {showSecondaryCurrency && <div className="stat-sub">{fmt(totalOut, baseCurrency)}</div>}
                </div>
                <div className="stat-card">
                  <div className="stat-label">Net</div>
                  <div className={`stat-value ${totalIn - totalOut >= 0 ? 'pos' : 'neg'}`}>{fmtD(totalIn - totalOut)}</div>
                  {showSecondaryCurrency && <div className="stat-sub">{fmt((totalIn - totalOut), 'AED')}</div>}
                </div>
              </div>
              {recurringChartData.length > 1 && (
                <>
                  <div className="section-label">Net recurring cash flow over time</div>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={recurringChartData}>
                      <CartesianGrid stroke="#E4DCC8" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }} stroke="#7A8699" />
                      <YAxis tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }} stroke="#7A8699" tickFormatter={(v) => { const rate = fxRates?.[displayCurrency] || 1; const symbol = CURRENCY_SYMBOLS[displayCurrency] || ''; const val = v / rate; return Math.abs(val) >= 1000000 ? `${symbol}${(val / 1000000).toFixed(1)}m` : `${symbol}${(val / 1000).toFixed(0)}k`; }} width={62} />
                      <Tooltip formatter={(v) => fmtD(v)} contentStyle={{ fontFamily: 'IBM Plex Sans', fontSize: 12, borderRadius: 4 }} />
                      <Legend wrapperStyle={{ fontFamily: 'IBM Plex Sans', fontSize: 11 }} />
                      <Line type="monotone" dataKey="income" name="Income" stroke="#5E8C7C" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="outflows" name="Outflows" stroke="#BD5B3A" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="net" name="Net" stroke="#C9A24A" strokeWidth={2.5} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </>
              )}
              <div className="recurring-list">
                {(showAllRecurringDash ? recurringItems : recurringItems.slice(0, 5)).map((r) => (
                  <div className="recurring-row" key={r.id}>
                    <span className={`flow-dot ${r.direction === 'in' ? 'flow-in' : 'flow-out'}`} />
                    <span className="recurring-name">{r.name}</span>
                    <span className="mono recurring-amount">{r.currency} {Number(r.amount).toLocaleString()}/{r.frequency}</span>
                  </div>
                ))}
                {recurringItems.length > 5 && (
                  <button className="btn-secondary" onClick={() => setShowAllRecurringDash((v) => !v)} style={{ marginTop: 6, fontSize: 12 }}>
                    {showAllRecurringDash ? 'Show less' : `Show all ${recurringItems.length} items`}
                  </button>
                )}
              </div>
            </div>

            {goals.length > 0 && (
              <div className="card">
                <div className="card-title">Your goals</div>
                {goals.map((g, i) => {
                  const pct = g.target > 0 ? (g.current / g.target) * 100 : 0;
                  const barColor = pct < 30 ? '#8A93A3' : pct < 80 ? '#4A7FA8' : '#4F8C6E';
                  return (
                    <div key={g.id} style={{ marginBottom: i === goals.length - 1 ? 0 : 20 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
                        <div>
                          <div style={{ fontSize: 13, color: '#101C2E', marginBottom: 2 }}>{g.name}</div>
                          <div className="mono" style={{ fontSize: 11, color: '#7A8699' }}>{fmt(g.current, baseCurrency)} of {fmt(g.target, baseCurrency)}</div>
                        </div>
                        <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 600, fontSize: 22, color: barColor }}>{Math.round(pct)}%</div>
                      </div>
                      <div style={{ background: '#EDE8DF', height: 10, borderRadius: 5, overflow: 'hidden' }}>
                        <div style={{ background: barColor, height: '100%', width: `${Math.min(Math.max(pct, 0), 100)}%`, borderRadius: 5 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="card">
              <div className="card-title">Your investments</div>
              <RiskBar breakdown={riskNow} total={liquidPortNow} currency={baseCurrency} fmtDisplay={fmtD} />
              <div className="kv-table">
                {(showAllPortfolioDash ? portfolio : portfolio.slice(0, 5)).map((h) => {
                  const native = Number(latest?.portfolioValues?.[h.id]) || 0;
                  return (
                    <div className="kv" key={h.id}>
                      <span>
                        {h.product}{' '}
                        {!h.illiquid && (
                          <span className="tag" style={{ borderColor: RISK_COLORS[h.risk], color: RISK_COLORS[h.risk] }}>{h.risk}</span>
                        )}
                        {h.illiquid && <span className="tag" style={{ borderColor: '#7A8699', color: '#7A8699' }}>Illiquid</span>}
                      </span>
                      <span className="mono">
                        {fmtD(native * rateFor(h.currency, latest?.fxRates, fxRates, baseCurrency))}
                        {showSecondaryCurrency && h.currency !== displayCurrency && <span className="sub-currency"> {h.currency} {native.toLocaleString()}</span>}
                      </span>
                    </div>
                  );
                })}
                {portfolio.length > 5 && (
                  <button className="btn-secondary" onClick={() => setShowAllPortfolioDash((v) => !v)} style={{ marginTop: 6, fontSize: 12 }}>
                    {showAllPortfolioDash ? 'Show less' : `Show all ${portfolio.length} holdings`}
                  </button>
                )}
              </div>
            </div>

            <button className="btn-primary" onClick={() => { setTab('chat'); sendChat(INTERVIEW_PROMPT); }}>
              <Sparkles size={15} /> Start interview (10 questions)
            </button>
            <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setTab('chat')}>
              <MessageCircle size={15} /> Open CFO Chat
            </button>
          </div>
        )}

        {tab === 'chat' && (
          <div className="chat-wrap">
            <div className="chat-header">
              <span className="chat-header-label">CFO Chat</span>
              <button className="icon-btn" onClick={clearChat} title="Clear chat history" style={{ opacity: 0.7, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Trash2 size={13} /> <span style={{ fontSize: 11 }}>Clear chat</span>
              </button>
            </div>
            <div className="chat-thread">
              {chat.map((m, i) => (
                <div className={`chat-bubble ${m.role === 'user' ? 'chat-user' : 'chat-assistant'}`} key={i}>
                  {Array.isArray(m.content)
                    ? m.content.map((block, j) =>
                        block.type === 'image' ? (
                          <img key={j} src={`data:${block.source.media_type};base64,${block.source.data}`} className="chat-image" alt="attachment" />
                        ) : block.type === 'document' ? (
                          <div className="file-chip" key={j}><FileText size={13} /> PDF attached</div>
                        ) : (
                          <p className="md-p" key={j}>{block.text}</p>
                        )
                      )
                    : m.role === 'assistant'
                    ? renderMarkdown(m.content)
                    : <p className="md-p">{m.content}</p>}
                </div>
              ))}
              {chatLoading && <div className="chat-bubble chat-assistant chat-loading">Thinking…</div>}
              {chatError && <div className="error-text">{chatError}</div>}
              <div ref={chatEndRef} />
            </div>

            {chat.length <= 1 && (
              <div className="quick-prompts">
                {QUICK_PROMPTS.map((p) => (
                  <button key={p} className="chip" onClick={() => sendChat(p)}>{p}</button>
                ))}
              </div>
            )}

            {attachment && (
              <div className="attachment-chip">
                {attachment.kind === 'image' ? (
                  <img src={attachment.dataUrl} alt="" className="attachment-thumb" />
                ) : attachment.kind === 'pdf' ? (
                  <FileText size={13} />
                ) : (
                  <Paperclip size={13} />
                )}
                <span>{attachment.name}{attachment.wasCompressed ? ' (resized)' : ''}</span>
                <button className="icon-btn" onClick={() => setAttachment(null)}><X size={13} /></button>
              </div>
            )}
            {attachError && <div className="error-text">{attachError}</div>}

            <div className="chat-input-row">
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*,application/pdf,.csv,.xlsx,.xls" onChange={handleFileSelect} />
              <button className="attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach image, CSV, or Excel file">
                <Paperclip size={16} />
              </button>
              <textarea
                className="input chat-textarea"
                placeholder="Ask your CFO anything, or share what's going on…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
              />
              <button className="send-btn" onClick={() => sendChat()} disabled={chatLoading || (!chatInput.trim() && !attachment)}>
                <Send size={16} />
              </button>

            </div>
          </div>
        )}

        {tab === 'update' && (
          <div className="stack">
            <div className="card">
              <div className="card-title">Monthly update</div>
              <p className="muted-text">Enter current balances and tell your CFO what's happening — both feed into the next conversation.</p>
              <div className="field">
                <label>Date</label>
                <div className="input" style={{ color: '#7A8699', cursor: 'default', userSelect: 'none' }}>
                  {new Date(updateForm.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>

              <div className="section-label">Account balances (own currency)</div>
              <div className="grid-2">
                {accounts.map((a) => (
                  <div className="field" key={a.id}>
                    <label>{a.name} <span className="tag">{a.currency}</span></label>
                    <input
                      type="number" className="input mono" placeholder="0"
                      value={updateForm.balances[a.id] ?? ''}
                      onChange={(e) => setUpdateForm({ ...updateForm, balances: { ...updateForm.balances, [a.id]: e.target.value } })}
                    />
                  </div>
                ))}
              </div>

              <div className="section-label">Portfolio values (own currency)</div>
              <div className="grid-2">
                {portfolio.map((h) => (
                  <div className="field" key={h.id}>
                    <label>{h.product} <span className="tag">{h.currency}</span></label>
                    <input
                      type="number" className="input mono" placeholder="0"
                      value={updateForm.portfolioValues[h.id] ?? ''}
                      onChange={(e) => setUpdateForm({ ...updateForm, portfolioValues: { ...updateForm.portfolioValues, [h.id]: e.target.value } })}
                    />
                  </div>
                ))}
              </div>

              {fxCurrencies.length > 0 && (
                <>
                  <div className="section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>FX rates (1 unit → {baseCurrency})</span>
                    <button className="btn-secondary" onClick={refreshFxRates} disabled={fxLoading} style={{ fontSize: 11, padding: '3px 10px' }}>
                      {fxLoading ? 'Fetching…' : '↻ Refresh live rates'}
                    </button>
                  </div>
                  {fxError && <p className="muted-text neg">{fxError}</p>}
                  <div className="grid-2">
                    {fxCurrencies.map((c) => (
                      <div className="field" key={c}>
                        <label>{c} → {baseCurrency}</label>
                        <input
                          type="number" step="0.0001" className="input mono"
                          value={updateForm.fxRates[c] ?? ''}
                          onChange={(e) => setUpdateForm({ ...updateForm, fxRates: { ...updateForm.fxRates, [c]: e.target.value } })}
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="section-label">What's going on?</div>
              <div className="field">
                <label>Life update (optional, gets added to your CFO's context)</label>
                <textarea
                  className="input" rows={4}
                  placeholder="e.g. started a new role, big expense coming up, changed plans on a goal…"
                  value={updateForm.lifeUpdate}
                  onChange={(e) => setUpdateForm({ ...updateForm, lifeUpdate: e.target.value })}
                />
              </div>

              <button className="btn-primary" onClick={saveSnapshot}>
                <Plus size={15} /> Save update
              </button>
            </div>
          </div>
        )}

        {tab === 'data' && (
          <div className="stack">
            <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <div className="card-title">Getting started</div>
                <p className="muted-text">New to HayaCFO? The guide walks you through setup in three quick steps.</p>
              </div>
              <a href="https://www.hayacfo.com/guide" target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>View guide →</a>
            </div>
            <div className="card">
              <div className="card-title">Export / backup</div>
              <p className="muted-text">
                life log and chat history — as a JSON file. Keep it somewhere safe as a backup, or paste its
                contents into a new chat for a deep-dive review with a different model.
              </p>
              <button className="btn-primary" onClick={exportData}>
                {exportCopied ? <Check size={15} /> : <Download size={15} />}
                {exportCopied ? 'Downloaded' : 'Download backup (.json)'}
              </button>
            </div>

            <div className="card">
              <div className="card-title">Import / restore</div>
              <p className="muted-text">
                Paste a previously exported JSON backup here to restore your accounts, portfolio, snapshots, life
                log, and chat history. This replaces your current data on this device.
              </p>
              <textarea
                className="input"
                rows={4}
                placeholder="Paste exported JSON here…"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <button className="btn-primary" onClick={importData} disabled={!importText.trim()}>
                <Sparkles size={15} /> Import data
              </button>
              {importStatus === 'success' && <p className="muted-text pos">Imported successfully.</p>}
              {importStatus === 'error' && <p className="muted-text neg">Couldn't parse that — check it's valid JSON exported from this app.</p>}
            </div>

            <div className="card">
              <div className="card-title">Accounts</div>
              {accounts.map((a) => (
                <div className="row" key={a.id}>
                  <input className="input" value={a.name} onChange={(e) => updateAccount(a.id, 'name', e.target.value)} style={{ flex: '1 1 auto', minWidth: 80 }} />
                  <select className="input select" value={a.type} onChange={(e) => updateAccount(a.id, 'type', e.target.value)} style={{ flex: '0 0 90px' }}>
                    <option value="asset">asset</option>
                    <option value="liability">liability</option>
                  </select>
                  <select className="input select mono" value={a.currency} onChange={(e) => updateAccount(a.id, 'currency', e.target.value)} style={{ flex: '0 0 75px' }}>
                    {['GBP','AED','USD','EUR','INR','SGD','CAD','AUD','SAR','QAR','CHF','JPY','HKD','NZD','ZAR'].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button className="icon-btn" onClick={() => removeAccount(a.id)}><Trash2 size={14} /></button>
                </div>
              ))}
              <button className="btn-secondary" onClick={addAccount}><Plus size={14} /> Add account</button>
            </div>

            <div className="card">
              <div className="card-title">Portfolio holdings</div>
              {portfolio.map((h) => (
                <div key={h.id} className="goal-row">
                  <input className="input" value={h.product} onChange={(e) => updateHolding(h.id, 'product', e.target.value)} />
                  <div className="goal-row-numbers">
                    <input className="input" placeholder="Country" value={h.country} onChange={(e) => updateHolding(h.id, 'country', e.target.value)} />
                    <select className="input mono" value={h.currency} onChange={(e) => updateHolding(h.id, 'currency', e.target.value)}>
                      {['GBP','AED','USD','EUR','INR','SGD','CAD','AUD','SAR','QAR','CHF','JPY','HKD','NZD','ZAR'].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select className="input select" value={h.risk} disabled={!!h.illiquid} title={h.illiquid ? 'Not used for illiquid holdings' : undefined} onChange={(e) => updateHolding(h.id, 'risk', e.target.value)}>
                      <option value="Low">Low</option>
                      <option value="Balanced">Balanced</option>
                      <option value="High">High</option>
                    </select>
                    <button className="icon-btn" onClick={() => removeHolding(h.id)}><Trash2 size={14} /></button>
                  </div>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={!!h.illiquid} onChange={(e) => updateHolding(h.id, 'illiquid', e.target.checked)} />
                    Illiquid (excluded from headline liquid net worth)
                  </label>
                </div>
              ))}
              <button className="btn-secondary" onClick={addHolding}><Plus size={14} /> Add holding</button>
            </div>

            <div className="card">
              <div className="card-title">Goals</div>
              {goals.map((g) => (
                <div key={g.id} className="goal-row">
                  <input className="input" value={g.name} onChange={(e) => updateGoal(g.id, 'name', e.target.value)} />
                  <div className="goal-row-numbers">
                    <input type="number" className="input mono" placeholder="Current" value={g.current || ''} onChange={(e) => updateGoal(g.id, 'current', Number(e.target.value))} />
                    <input type="number" className="input mono" placeholder="Target" value={g.target || ''} onChange={(e) => updateGoal(g.id, 'target', Number(e.target.value))} />
                    <input type="date" className="input" value={g.targetDate} onChange={(e) => updateGoal(g.id, 'targetDate', e.target.value)} style={{ maxWidth: '100%', minWidth: 0 }} />
                    <button className="icon-btn" onClick={() => removeGoal(g.id)}><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
              <button className="btn-secondary" onClick={addGoal}><Plus size={14} /> Add goal</button>
            </div>

            <div className="card">
              <div className="card-title">Recurring items</div>
              {recurringItems.map((r) => (
                <div key={r.id} className="goal-row">
                  <input className="input" value={r.name} onChange={(e) => updateRecurring(r.id, 'name', e.target.value)} />
                  <div className="goal-row-numbers recurring-row-numbers">
                    <input type="number" className="input mono" placeholder="Amount" value={r.amount || ''} onChange={(e) => updateRecurring(r.id, 'amount', Number(e.target.value))} />
                    <select className="input mono" value={r.currency} style={{ maxWidth: 80 }} onChange={(e) => updateRecurring(r.id, 'currency', e.target.value)}>
                      {['GBP','AED','USD','EUR','INR','SGD','CAD','AUD','SAR','QAR','CHF','JPY','HKD','NZD','ZAR'].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select className="input select" value={r.frequency} onChange={(e) => updateRecurring(r.id, 'frequency', e.target.value)}>
                      <option value="monthly">monthly</option>
                      <option value="weekly">weekly</option>
                      <option value="yearly">yearly</option>
                    </select>
                    <select className="input select" value={r.direction} onChange={(e) => updateRecurring(r.id, 'direction', e.target.value)}>
                      <option value="in">in</option>
                      <option value="out">out</option>
                    </select>
                    <button className="icon-btn" onClick={() => removeRecurring(r.id)}><Trash2 size={14} /></button>
                  </div>
                  <input className="input" placeholder="Category" value={r.category || ''} onChange={(e) => updateRecurring(r.id, 'category', e.target.value)} style={{ marginTop: 6 }} />
                </div>
              ))}
              <button className="btn-secondary" onClick={addRecurring}><Plus size={14} /> Add recurring item</button>
            </div>

            <div className="card">
              <div className="card-title">Life log</div>
              <div className="row">
                <input className="input" placeholder="Add a note for your CFO…" value={lifeNoteDraft} onChange={(e) => setLifeNoteDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addStandaloneLifeNote(); }} />
                <button className="btn-secondary" onClick={addStandaloneLifeNote}><Plus size={14} /></button>
              </div>
              {(() => {
                const sorted = [...lifeLog].reverse();
                const visible = showAllLifeLog ? sorted : sorted.slice(0, 10);
                return (
                  <>
                    {visible.map((l) => (
                      <div className="kv" key={l.id}>
                        <span><span className="mono" style={{ marginRight: 8 }}>{l.date}</span>{l.text}</span>
                        <button className="icon-btn" onClick={() => removeLifeLogEntry(l.id)}><Trash2 size={14} /></button>
                      </div>
                    ))}
                    {lifeLog.length > 10 && (
                      <button className="btn-secondary" onClick={() => setShowAllLifeLog((v) => !v)} style={{ marginTop: 6, fontSize: 12 }}>
                        {showAllLifeLog ? `Show less` : `Show all ${lifeLog.length} entries`}
                      </button>
                    )}
                  </>
                );
              })()}
              {lifeLog.length === 0 && <p className="muted-text">Nothing logged yet — add context here or via Update.</p>}
            </div>

            <div className="card">
              <div className="card-title">Display currency</div>
              <p className="muted-text">Choose which currency to show as the headline figure. Your data stays in {baseCurrency} — this is a display preference only.</p>
              <select className="input select" value={displayCurrency} onChange={(e) => handleDisplayCurrencyChange(e.target.value)} disabled={displayFxLoading}>
                {['GBP','AED','USD','EUR','INR','SGD','CAD','AUD','SAR','QAR','CHF','JPY','HKD','NZD','ZAR'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {displayFxLoading && <p className="muted-text" style={{ marginTop: 6 }}>Updating rate…</p>}
              {displayFxError && <p className="muted-text neg" style={{ marginTop: 6 }}>{displayFxError}</p>}
              <label className="checkbox-label" style={{ marginTop: 12 }}>
                <input
                  type="checkbox"
                  checked={showSecondaryCurrency}
                  onChange={(e) => persist({ ...data, showSecondaryCurrency: e.target.checked })}
                />
                Show {baseCurrency} alongside figures
              </label>
              <p className="muted-text" style={{ marginTop: 4 }}>When off, only your display currency is shown — {baseCurrency} figures are hidden throughout.</p>
            </div>

            <div className="card">
              <div className="card-title">Account</div>
              <p className="muted-text">Signed in as {session?.user?.email}</p>
              <button className="btn-secondary" onClick={signOut} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <LogOut size={14} /> Sign out
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const baseCSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&family=Spectral:wght@400;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

* { box-sizing: border-box; }

@keyframes insightIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.insight-card {
  animation: insightIn 0.5s cubic-bezier(0.2,0.7,0.3,1) both;
  position: relative;
  background: linear-gradient(155deg, #12233a 0%, #101C2E 100%);
  border: 1px solid rgba(201,162,74,0.35);
  border-radius: 20px;
  padding: 22px 22px 20px;
  box-shadow: 0 16px 34px -18px rgba(11,20,32,0.7);
  margin-bottom: 18px;
}
.insight-dismiss {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background: rgba(255,255,255,0.06);
  border: none;
  color: #8397ae;
  font-size: 15px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  padding: 0;
  min-width: 44px;
  min-height: 44px;
  margin: -7px -7px 0 0;
}
.insight-dismiss:hover { background: rgba(255,255,255,0.12); color: #F7F3EA; }

.loading-screen {
  font-family: 'IBM Plex Mono', monospace;
  color: #7A8699;
  padding: 40px;
  text-align: center;
}

.cfo {
  font-family: 'IBM Plex Sans', sans-serif;
  background: #F7F3EA;
  color: #101C2E;
  min-height: 100%;
  max-width: 720px;
  margin: 0 auto;
}

.masthead {
  background: #101C2E;
  color: #F7F3EA;
  padding: 16px 20px 16px;
  padding-top: max(12px, env(safe-area-inset-top, 12px));
}
.masthead-eyebrow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.3px;
  text-transform: none;
  color: #F7F3EA;
  margin-bottom: 10px;
}
.streak-badge {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: normal;
  text-transform: none;
  color: #F7F3EA;
  background: rgba(201,162,74,0.18);
  border-radius: 10px;
  padding: 2px 8px;
}
.cfo-score-btn {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #C9A24A;
  background: none;
  border: 1px solid rgba(201,162,74,0.35);
  border-radius: 10px;
  padding: 2px 9px;
  cursor: pointer;
  white-space: nowrap;
}
.score-popover {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: 230px;
  background: #1B2C42;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  padding: 12px 14px;
  z-index: 50;
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
}
.score-popover-title {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #C9A24A;
  margin-bottom: 8px;
}
.score-bar-track {
  width: 100%;
  height: 4px;
  background: rgba(255,255,255,0.12);
  border-radius: 2px;
  margin-bottom: 10px;
}
.score-bar-fill {
  height: 100%;
  background: #C9A24A;
  border-radius: 2px;
  transition: width 0.4s ease;
}
.score-popover-body {
  margin: 0;
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 12px;
  color: #D4DCE8;
  line-height: 1.5;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 400;
}
.score-popover-cta {
  display: block;
  margin-top: 10px;
  background: none;
  border: none;
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 11px;
  color: #C9A24A;
  cursor: pointer;
  padding: 0;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 500;
  opacity: 0.85;
}
.streak-popover {
  position: absolute;
  top: calc(100% + 10px);
  left: 0;
  width: 210px;
  background: #1B2C42;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  padding: 10px 12px;
  z-index: 50;
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
}
.streak-popover-title {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #C9A24A;
  margin-bottom: 5px;
}
.streak-popover-body {
  margin: 0;
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 12px;
  color: #D4DCE8;
  line-height: 1.5;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 400;
}
.masthead-eye-btn {
  background: rgba(255,255,255,0.08);
  border: none;
  border-radius: 50%;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(247,243,234,0.7);
  cursor: pointer;
}
.masthead-eye-btn:hover { background: rgba(255,255,255,0.14); }
.market-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 8px;
  padding: 4px 9px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  min-width: 96px;
  white-space: nowrap;
}
.market-chip-label {
  color: rgba(247,243,234,0.5);
  letter-spacing: 0.04em;
}
.market-chip-val {
  color: #EDE8DF;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.market-chip-good { color: #5E8C7C; }
.market-chip-bad { color: #BD5B3A; }
.masthead-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(247,243,234,0.5);
  margin-bottom: 4px;
}
.masthead-hero {
  font-family: 'IBM Plex Serif', serif;
  font-size: 48px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.5px;
}
.masthead-sub-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.masthead-secondary {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 13px;
  color: rgba(247,243,234,0.5);
}
.masthead-delta {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
}
.masthead-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: rgba(255,255,255,0.08);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 14px;
}
.masthead-cell {
  background: rgba(255,255,255,0.04);
  padding: 10px 12px;
}
.masthead-cell-total {
  background: rgba(201,162,74,0.10);
}
.masthead-cell-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(247,243,234,0.5);
  margin-bottom: 3px;
}
.masthead-cell-value {
  font-family: 'IBM Plex Serif', serif;
  font-size: 18px;
  font-weight: 600;
}
.masthead-cell-secondary {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  color: rgba(247,243,234,0.45);
  margin-top: 2px;
}
.masthead-date {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  color: rgba(247,243,234,0.35);
}

.tabs {
  display: flex;
  background: #FFFFFF;
  border-bottom: 1px solid rgba(27,36,48,0.08);
  position: sticky;
  top: 0;
  z-index: 5;
  overflow-x: auto;
}
.tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 8px;
  font-size: 12px;
  font-weight: 500;
  color: #7A8699;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  white-space: nowrap;
}
.tab.active { color: #101C2E; border-bottom-color: #C9A24A; }

.content { padding: 16px; }
.stack { display: flex; flex-direction: column; gap: 14px; }

.card {
  background: #FFFFFF;
  border: 1px solid rgba(27,36,48,0.08);
  border-radius: 8px;
  padding: 14px;
}
.card-title {
  font-family: 'IBM Plex Serif', serif;
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 10px;
}
.gap-card { border-color: rgba(201,162,74,0.4); background: #FBF6E8; }

.stat-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.stat-card {
  background: #FFFFFF;
  border: 1px solid rgba(27,36,48,0.10);
  border-radius: 6px;
  padding: 12px;
}
.stat-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #7A8699;
  margin-bottom: 4px;
}
.stat-value {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 16px;
  font-weight: 600;
}
.stat-sub {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10.5px;
  color: #7A8699;
  margin-top: 2px;
}
.pos { color: #5E8C7C; }
.neg { color: #BD5B3A; }

.kv-table { display: flex; flex-direction: column; gap: 2px; }
.kv {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12.5px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(27,36,48,0.06);
  gap: 10px;
}
.kv:last-child { border-bottom: none; }
.mono { font-family: 'IBM Plex Mono', monospace; }

.tag {
  font-size: 9px;
  text-transform: uppercase;
  color: #C9A24A;
  border: 1px solid #C9A24A;
  border-radius: 3px;
  padding: 1px 4px;
  margin-left: 4px;
}

.risk-bar {
  display: flex;
  height: 10px;
  border-radius: 5px;
  overflow: hidden;
  background: #E4DCC8;
  margin-bottom: 10px;
}
.risk-bar-segment { height: 100%; }
.risk-bar-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 12px; }
.risk-legend-item {
  display: flex; align-items: center; gap: 5px;
  font-size: 11.5px; font-family: 'IBM Plex Mono', monospace; color: #5A6677;
}
.risk-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

.recurring-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.recurring-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; padding: 5px 0;
  border-bottom: 1px solid rgba(27,36,48,0.06);
}
.recurring-row:last-child { border-bottom: none; }
.recurring-name { flex: 1; }
.recurring-amount { color: #5A6677; }
.flow-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.flow-in { background: #5E8C7C; }
.flow-out { background: #BD5B3A; }

.dial-row { display: flex; flex-wrap: wrap; gap: 14px; justify-content: flex-start; }
.dial { display: flex; flex-direction: column; align-items: center; width: 110px; }
.dial-label { font-size: 12px; font-weight: 500; text-align: center; margin-top: 4px; }
.dial-sub { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #7A8699; text-align: center; margin-top: 3px; }

.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.field label {
  font-size: 11px; color: #7A8699; font-family: 'IBM Plex Mono', monospace;
}
.input {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 13px;
  padding: 8px 10px;
  border: 1px solid rgba(27,36,48,0.18);
  border-radius: 4px;
  background: #FBF9F4;
  color: #101C2E;
  width: 100%;
}
.input.mono { font-family: 'IBM Plex Mono', monospace; }
.input.select { max-width: 110px; }
textarea.input { resize: vertical; }

.grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
@media (max-width: 480px) {
  .grid-2 { grid-template-columns: 1fr; }
  .stat-row { grid-template-columns: 1fr 1fr; }
}

.section-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #C9A24A;
  margin: 14px 0 8px;
  border-top: 1px solid rgba(27,36,48,0.10);
  padding-top: 10px;
}

.btn-primary {
  display: inline-flex; align-items: center; gap: 6px;
  background: #101C2E; color: #F7F3EA;
  border: none; border-radius: 4px;
  padding: 10px 18px; font-size: 13px; font-weight: 500;
  cursor: pointer; margin-top: 6px;
  width: 100%; justify-content: center;
}
.btn-primary:disabled { opacity: 0.5; cursor: default; }

.btn-secondary {
  display: inline-flex; align-items: center; gap: 6px;
  background: none; border: 1px solid rgba(27,36,48,0.2);
  border-radius: 4px; padding: 7px 12px; font-size: 12.5px;
  color: #101C2E; cursor: pointer; margin-top: 4px;
}

.row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.row .input:first-child { flex: 1; }

.goal-row { border-bottom: 1px solid rgba(27,36,48,0.08); padding-bottom: 10px; margin-bottom: 10px; }
.goal-row > .input { margin-bottom: 8px; }
.goal-row-numbers { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 8px; align-items: end; overflow: hidden; }
input[type="date"] { max-width: 100%; min-width: 0; width: 100%; box-sizing: border-box; }
@media (max-width: 600px) {
  .goal-row-numbers { grid-template-columns: 1fr 1fr auto; flex-wrap: wrap; }
  .goal-row-numbers input[type="date"] { grid-column: 1 / span 2; }
}
.recurring-row-numbers { grid-template-columns: 1fr 70px 1fr 60px auto; }
@media (max-width: 480px) {
  .recurring-row-numbers { grid-template-columns: 1fr 60px auto; }
}

.checkbox-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 11.5px; color: #7A8699;
  margin-top: 8px; cursor: pointer;
}
.checkbox-label input { cursor: pointer; }

.icon-btn { background: none; border: none; color: #BD5B3A; cursor: pointer; padding: 6px; display: flex; }

.muted-text { font-size: 12.5px; color: #7A8699; line-height: 1.5; }
.error-text { font-size: 12.5px; color: #BD5B3A; margin-top: 8px; }

/* Chat */
.chat-wrap { display: flex; flex-direction: column; gap: 10px; height: calc(100vh - 200px); min-height: 420px; }
.chat-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 4px; border-bottom: 1px solid rgba(27,36,48,0.08); }
.chat-header-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #7A8699; }
.chat-thread { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 2px; }
.chat-bubble {
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.55;
  max-width: 92%;
}
.chat-assistant { background: #FFFFFF; border: 1px solid rgba(27,36,48,0.08); align-self: flex-start; }
.chat-user { background: #101C2E; color: #F7F3EA; align-self: flex-end; }
.chat-loading { color: #7A8699; font-style: italic; }
.md-h { font-family: 'IBM Plex Serif', serif; font-size: 14.5px; font-weight: 600; margin: 8px 0 4px; }
.md-h:first-child { margin-top: 0; }
.md-p { margin: 0 0 6px; }
.md-list { margin: 0 0 6px; padding-left: 18px; }
.chat-user .md-p { color: #F7F3EA; }

.quick-prompts { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  font-size: 11.5px;
  border: 1px solid rgba(27,36,48,0.18);
  background: #FFFFFF;
  border-radius: 14px;
  padding: 6px 12px;
  cursor: pointer;
  color: #101C2E;
}

.chat-input-row { display: flex; gap: 8px; align-items: flex-end; }
.chat-textarea { min-height: 44px; max-height: 120px; }
.send-btn {
  background: #101C2E; color: #F7F3EA;
  border: none; border-radius: 4px;
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
}
.send-btn:disabled { opacity: 0.4; cursor: default; }
.attach-btn {
  background: none; color: #101C2E;
  border: 1px solid rgba(27,36,48,0.18); border-radius: 4px;
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
}
.attachment-chip {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; background: #FFFFFF;
  border: 1px solid rgba(27,36,48,0.15); border-radius: 14px;
  padding: 4px 10px; align-self: flex-start;
}
.attachment-thumb { width: 20px; height: 20px; object-fit: cover; border-radius: 3px; }
.chat-image { max-width: 100%; border-radius: 6px; margin-bottom: 6px; display: block; }
.file-chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; background: rgba(27,36,48,0.06);
  border-radius: 12px; padding: 4px 10px; margin-bottom: 6px;
}
`;
