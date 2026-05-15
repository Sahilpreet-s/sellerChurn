# Seller Churn Early Warning — IndiaMART

An internal-style dashboard prototype that helps IndiaMART's retention team identify paid sellers who are at risk of churning **before** their renewal date. It surfaces leading indicators (login activity, BL consumption, PNS pickups, LMS replies, catalog quality) alongside qualitative call-center insights, so a Key Account Manager can act 90 days ahead of renewal instead of reacting after a non-renewal.

> Live preview: https://sellerchurn.lovable.app

---

## Table of Contents

1. [Problem & Goal](#problem--goal)
2. [What the App Does](#what-the-app-does)
3. [Screens](#screens)
4. [Risk Scoring Model](#risk-scoring-model)
5. [Tech Stack](#tech-stack)
6. [Project Structure](#project-structure)
7. [Local Development](#local-development)
8. [Data Model](#data-model)
9. [Design System](#design-system)
10. [Roadmap](#roadmap)

---

## Problem & Goal

IndiaMART earns recurring revenue from paid seller subscriptions (Silver / Gold / Platinum / Star packages). A meaningful chunk of revenue leaks every quarter through **silent churn** — sellers whose engagement has been declining for months but who only get a retention call **after** they fail to renew.

The goal of this prototype is to:

- Aggregate the behavioural signals that already exist in IndiaMART's stack (login %, BL consumption %, PNS pickup %, LMS reply %, % retail BLs recommended, catalog score).
- Combine those with **call-center transcript insights** (sentiment, recurring complaints, competitor mentions).
- Produce a single **Risk Score (0–100)** per seller and a clear action surface for the retention team.

---

## What the App Does

- **Cohort dashboard** of every paid seller renewing in the next 90 days, sortable and filterable by risk band, package, and retention status (Pending / Resolved).
- **Per-seller deep-dive** with:
  - Summary cards (ARR, package, renewal date, risk score).
  - A plain-English explanation of **why** the seller was flagged.
  - Tabbed detail view:
    - **Past Behaviour** — line chart of the 6 leading indicators over the last 3 months. Metrics that are *not* declining are drawn in green so the retention team can immediately see what's healthy vs. what's slipping.
    - **Call Insights** — recent transcripts from the IndiaMART exec call center: sentiment, key issues raised, verbatim quotes (e.g. competitor mentions, pricing complaints).
    - **Retention Guide** — recommended next actions for the KAM.
    - **IndiaMART Leads** — 6-month chart of inbound enquiries, Buy Leads consumed, and PNS calls received, so the KAM can correlate behaviour with actual lead supply.

---

## Screens

| Route | Purpose |
|---|---|
| `/` | Dashboard — searchable, filterable cohort of at-risk sellers |
| `/seller/$sellerId` | Per-seller drill-down with tabs |

---

## Risk Scoring Model

The risk score is computed deterministically in `src/lib/mock-sellers.ts` (`calcRisk`). Each metric contributes two things: its **current level** and the **3-month drop**. Higher = more risk.

| Signal | Current-level weight | Trend-drop weight | Why it matters |
|---|---|---|---|
| Login % | 0.20 | 0.50 | Disengagement is the earliest churn signal |
| BL Consumption % | 0.20 | 0.50 | Sellers stop spending Buy Leads before they leave |
| PNS Pickup Rate % | 0.15 | 0.40 | Missed buyer calls = lost ROI perception |
| LMS Reply Rate % | 0.15 | 0.40 | Slow replies kill conversion |
| % Retail BL Recommended | 0.15 | — | High retail share = poor lead-quality fit |
| Catalog Score | 0.10 | — | Weak catalog → lower visibility |

Bands: **High ≥ 55**, **Medium 30–54**, **Low < 30**.

---

## Tech Stack

- **TanStack Start v1** (React 19 SSR framework) with file-based routing
- **Vite 7** build tool, deployed to a Cloudflare Workers-compatible runtime
- **TypeScript** (strict)
- **Tailwind CSS v4** via `src/styles.css` with semantic OKLCH design tokens
- **shadcn/ui** components (Radix primitives)
- **Recharts** for line charts
- **Lucide** icons

There is **no backend** in this prototype — all data lives in `src/lib/mock-sellers.ts` and is generated deterministically so the dashboard renders identically on server and client.

---

## Project Structure

```
src/
├── routes/
│   ├── __root.tsx              # Root shell (html/head/body)
│   ├── index.tsx               # Dashboard
│   └── seller.$sellerId.tsx    # Per-seller drill-down (tabs + charts)
├── components/ui/              # shadcn/ui primitives
├── lib/
│   ├── mock-sellers.ts         # Seller cohort + risk scoring + call insights
│   └── utils.ts
├── styles.css                  # Tailwind v4 + design tokens
├── router.tsx
└── start.ts
```

---

## Local Development

```bash
bun install
bun run dev
```

The dev server runs on Vite. File-based routes in `src/routes/` are auto-registered into `src/routeTree.gen.ts` (do not edit that file by hand).

Build:

```bash
bun run build
```

---

## Data Model

```ts
type Seller = {
  id: string;                    // e.g. "S-10293"
  name: string;
  company: string;
  city: string;
  category: string;
  packageType: "Gold" | "Platinum" | "Silver" | "Star";
  renewalDate: string;           // ISO date
  daysToRenewal: number;
  arr: number;                   // annual recurring revenue (INR)
  status: "Pending" | "Resolved";
  riskScore: number;             // 0–100
  metrics: {
    loginPct: MetricHistory[];
    blConsumptionPct: MetricHistory[];
    pnsPickupRatePct: MetricHistory[];
    lmsReplyRatePct: MetricHistory[];
    retailBlRecommendedPct: MetricHistory[];
    catalogScore: MetricHistory[];
  };
  callInsights?: CallInsight[];
};
```

Each `CallInsight` captures one call-center interaction: date, agent, sentiment, summary, list of issues raised, and an optional verbatim quote.

---

## Design System

All colours live as semantic tokens in `src/styles.css` using `oklch(...)`:

- `--background`, `--foreground`, `--primary`, `--secondary`, `--muted`, `--accent`
- Status tokens: `--success`, `--warning`, `--destructive`

Components never hard-code hex colours — they reference these tokens (e.g. `bg-warning/15 text-warning`). This keeps light/dark mode and brand tweaks single-source.

---

## Roadmap

- Wire to real IndiaMART warehouse instead of mock data
- Push retention actions back into the CRM (mark resolved, schedule follow-up)
- LLM-generated call summaries directly from raw transcripts
- Cohort-level trend view (week-over-week churn risk movement)
- Per-KAM workload view and SLA tracking
