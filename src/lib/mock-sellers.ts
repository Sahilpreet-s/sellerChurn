export type MetricHistory = { month: string; value: number };

export type SellerStatus = "Pending" | "Resolved";

export type Seller = {
  id: string;
  name: string;
  company: string;
  city: string;
  category: string;
  packageType: "Gold" | "Platinum" | "Silver" | "Star";
  renewalDate: string;
  daysToRenewal: number;
  arr: number;
  status: SellerStatus;
  riskScore: number; // 0-100, higher = more risk
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

export type CallSentiment = "Negative" | "Neutral" | "Positive";

export type CallInsight = {
  id: string;
  date: string; // YYYY-MM-DD
  durationMin: number;
  agent: string;
  sentiment: CallSentiment;
  summary: string;
  issues: string[]; // pain points raised by seller
  quote?: string;  // verbatim concern
};

const months = ["Feb", "Mar", "Apr"];

// Deterministic pseudo-jitter (avoids SSR hydration mismatch from Math.random)
function jitter(seed: number, i: number): number {
  const x = Math.sin(seed * 9301 + i * 49297) * 233280;
  return Math.round((x - Math.floor(x)) * 6 - 3); // -3..+3
}

function trend(seed: number, start: number, delta: number): MetricHistory[] {
  return months.map((m, i) => ({
    month: m,
    value: Math.max(0, Math.min(100, start + delta * i + jitter(seed, i))),
  }));
}

// All sellers in this cohort renew in EXACTLY 90 days
const RENEWAL_DATE = "2026-08-13";
const DAYS_TO_RENEWAL = 90;

type RawSeller = Omit<Seller, "riskScore" | "renewalDate" | "daysToRenewal">;

const sellersRaw: RawSeller[] = [
  {
    id: "S-10293", name: "Rakesh Sharma", company: "Sharma Industries", city: "Delhi",
    category: "Industrial Supplies", packageType: "Platinum", arr: 185000, status: "Pending",
    metrics: {
      loginPct: trend(1, 78, -15), blConsumptionPct: trend(2, 85, -20), pnsPickupRatePct: trend(3, 72, -12),
      lmsReplyRatePct: trend(4, 65, -18), retailBlRecommendedPct: trend(5, 40, 5), catalogScore: trend(6, 70, -8),
    },
  },
  {
    id: "S-10847", name: "Priya Mehta", company: "Mehta Textiles", city: "Surat",
    category: "Textiles & Fabrics", packageType: "Gold", arr: 95000, status: "Pending",
    metrics: {
      loginPct: trend(7, 45, -10), blConsumptionPct: trend(8, 50, -15), pnsPickupRatePct: trend(9, 40, -8),
      lmsReplyRatePct: trend(10, 35, -10), retailBlRecommendedPct: trend(11, 60, 8), catalogScore: trend(12, 55, -5),
    },
  },
  {
    id: "S-11532", name: "Amit Patel", company: "Patel Machine Tools", city: "Ahmedabad",
    category: "Machinery", packageType: "Star", arr: 320000, status: "Resolved",
    metrics: {
      loginPct: trend(13, 92, -2), blConsumptionPct: trend(14, 88, 1), pnsPickupRatePct: trend(15, 85, 0),
      lmsReplyRatePct: trend(16, 82, 2), retailBlRecommendedPct: trend(17, 25, 1), catalogScore: trend(18, 90, 1),
    },
  },
  {
    id: "S-12104", name: "Sunita Reddy", company: "Reddy Chemicals", city: "Hyderabad",
    category: "Chemicals", packageType: "Platinum", arr: 215000, status: "Pending",
    metrics: {
      loginPct: trend(19, 60, -8), blConsumptionPct: trend(20, 70, -10), pnsPickupRatePct: trend(21, 55, -6),
      lmsReplyRatePct: trend(22, 50, -7), retailBlRecommendedPct: trend(23, 45, 3), catalogScore: trend(24, 65, -4),
    },
  },
  {
    id: "S-12889", name: "Vikram Singh", company: "Singh Electricals", city: "Ludhiana",
    category: "Electrical Equipment", packageType: "Gold", arr: 110000, status: "Pending",
    metrics: {
      loginPct: trend(25, 35, -12), blConsumptionPct: trend(26, 40, -18), pnsPickupRatePct: trend(27, 30, -10),
      lmsReplyRatePct: trend(28, 25, -8), retailBlRecommendedPct: trend(29, 70, 10), catalogScore: trend(30, 45, -10),
    },
  },
  {
    id: "S-13456", name: "Anjali Nair", company: "Nair Packaging", city: "Kochi",
    category: "Packaging", packageType: "Silver", arr: 65000, status: "Resolved",
    metrics: {
      loginPct: trend(31, 80, -3), blConsumptionPct: trend(32, 75, -2), pnsPickupRatePct: trend(33, 78, 1),
      lmsReplyRatePct: trend(34, 72, 0), retailBlRecommendedPct: trend(35, 35, 2), catalogScore: trend(36, 80, 0),
    },
  },
  {
    id: "S-14021", name: "Mohammed Khan", company: "Khan Hardware Co", city: "Mumbai",
    category: "Hardware", packageType: "Gold", arr: 125000, status: "Pending",
    metrics: {
      loginPct: trend(37, 55, -10), blConsumptionPct: trend(38, 60, -12), pnsPickupRatePct: trend(39, 48, -8),
      lmsReplyRatePct: trend(40, 40, -10), retailBlRecommendedPct: trend(41, 55, 5), catalogScore: trend(42, 58, -6),
    },
  },
  {
    id: "S-14778", name: "Neha Gupta", company: "Gupta Plastics", city: "Pune",
    category: "Plastics", packageType: "Platinum", arr: 195000, status: "Resolved",
    metrics: {
      loginPct: trend(43, 88, 1), blConsumptionPct: trend(44, 82, 2), pnsPickupRatePct: trend(45, 80, 1),
      lmsReplyRatePct: trend(46, 78, 1), retailBlRecommendedPct: trend(47, 30, 0), catalogScore: trend(48, 85, 2),
    },
  },
  {
    id: "S-15203", name: "Rohit Iyer", company: "Iyer Auto Parts", city: "Chennai",
    category: "Automotive", packageType: "Gold", arr: 105000, status: "Pending",
    metrics: {
      loginPct: trend(49, 42, -14), blConsumptionPct: trend(50, 48, -16), pnsPickupRatePct: trend(51, 38, -10),
      lmsReplyRatePct: trend(52, 32, -8), retailBlRecommendedPct: trend(53, 65, 8), catalogScore: trend(54, 50, -8),
    },
  },
  {
    id: "S-15994", name: "Kavita Joshi", company: "Joshi Furniture", city: "Jaipur",
    category: "Furniture", packageType: "Silver", arr: 55000, status: "Resolved",
    metrics: {
      loginPct: trend(55, 68, -5), blConsumptionPct: trend(56, 72, -4), pnsPickupRatePct: trend(57, 60, -3),
      lmsReplyRatePct: trend(58, 58, -5), retailBlRecommendedPct: trend(59, 42, 2), catalogScore: trend(60, 70, -2),
    },
  },
];

function calcRisk(s: RawSeller): number {
  const m = s.metrics;
  const latest = (h: MetricHistory[]) => h[h.length - 1].value;
  const trendDrop = (h: MetricHistory[]) => h[0].value - h[h.length - 1].value;

  const loginRisk = (100 - latest(m.loginPct)) * 0.2 + Math.max(0, trendDrop(m.loginPct)) * 0.5;
  const blRisk = (100 - latest(m.blConsumptionPct)) * 0.2 + Math.max(0, trendDrop(m.blConsumptionPct)) * 0.5;
  const pnsRisk = (100 - latest(m.pnsPickupRatePct)) * 0.15 + Math.max(0, trendDrop(m.pnsPickupRatePct)) * 0.4;
  const lmsRisk = (100 - latest(m.lmsReplyRatePct)) * 0.15 + Math.max(0, trendDrop(m.lmsReplyRatePct)) * 0.4;
  const retailRisk = latest(m.retailBlRecommendedPct) * 0.15;
  const catalogRisk = (100 - latest(m.catalogScore)) * 0.1;

  return Math.min(100, Math.round(loginRisk + blRisk + pnsRisk + lmsRisk + retailRisk + catalogRisk));
}

const callsBySeller: Record<string, CallInsight[]> = {
  "S-10293": [
    { id: "C1", date: "2026-04-28", durationMin: 14, agent: "Anita R.", sentiment: "Negative",
      summary: "Seller frustrated with poor lead quality and unanswered support tickets.",
      issues: ["Lead quality dropped", "Support response slow", "Considering competitor"],
      quote: "I'm paying Platinum money but most leads are retail buyers wasting my time." },
    { id: "C2", date: "2026-03-15", durationMin: 9, agent: "Vikas K.", sentiment: "Neutral",
      summary: "Discussed BL filter tuning. Seller agreed to try but skeptical.",
      issues: ["BL filters not working as expected"] },
  ],
  "S-10847": [
    { id: "C1", date: "2026-04-22", durationMin: 11, agent: "Anita R.", sentiment: "Negative",
      summary: "Seller says enquiries dropped sharply, blames algorithm changes.",
      issues: ["Drop in enquiries", "Catalog visibility concern"],
      quote: "Last 2 months I'm getting half the calls I used to get." },
  ],
  "S-12104": [
    { id: "C1", date: "2026-04-30", durationMin: 18, agent: "Rahul S.", sentiment: "Negative",
      summary: "Pricing complaint — feels package is too expensive vs ROI received.",
      issues: ["Pricing vs ROI", "Wants discount on renewal"],
      quote: "Renewal cost has gone up 20% but my orders haven't." },
  ],
  "S-12889": [
    { id: "C1", date: "2026-05-02", durationMin: 22, agent: "Priya D.", sentiment: "Negative",
      summary: "Seller threatening to switch to TradeIndia. Multiple complaints unresolved.",
      issues: ["Competitor offer received", "Buyer disputes unhandled", "Catalog edits rejected"],
      quote: "TradeIndia is offering me same package at 30% less. Why should I stay?" },
    { id: "C2", date: "2026-04-10", durationMin: 7, agent: "Priya D.", sentiment: "Negative",
      summary: "Seller upset about PNS missed calls — wants better routing.",
      issues: ["PNS routing"] },
  ],
  "S-14021": [
    { id: "C1", date: "2026-04-18", durationMin: 12, agent: "Vikas K.", sentiment: "Neutral",
      summary: "Seller wants help refreshing catalog images. Open to retention if helped.",
      issues: ["Needs catalog support"] },
  ],
  "S-15203": [
    { id: "C1", date: "2026-04-25", durationMin: 16, agent: "Anita R.", sentiment: "Negative",
      summary: "Frustrated with LMS UI, says team can't keep up with replies.",
      issues: ["LMS hard to use", "Team training gap"],
      quote: "My staff doesn't understand the new LMS. We're losing leads daily." },
  ],
  "S-11532": [
    { id: "C1", date: "2026-04-20", durationMin: 8, agent: "Rahul S.", sentiment: "Positive",
      summary: "Happy with platform performance, asking about premium add-ons.",
      issues: [] },
  ],
  "S-14778": [
    { id: "C1", date: "2026-04-12", durationMin: 6, agent: "Priya D.", sentiment: "Positive",
      summary: "Seller satisfied, mentioned strong order growth.",
      issues: [] },
  ],
  "S-13456": [],
  "S-15994": [
    { id: "C1", date: "2026-04-05", durationMin: 5, agent: "Vikas K.", sentiment: "Neutral",
      summary: "Routine check-in. No major concerns raised.",
      issues: [] },
  ],
};

export const sellers: Seller[] = sellersRaw
  .map((s) => ({
    ...s,
    renewalDate: RENEWAL_DATE,
    daysToRenewal: DAYS_TO_RENEWAL,
    riskScore: calcRisk(s),
    callInsights: callsBySeller[s.id] ?? [],
  }))
  .sort((a, b) => b.riskScore - a.riskScore || a.id.localeCompare(b.id));

export function getSeller(id: string) {
  return sellers.find((s) => s.id === id);
}

export function riskBand(score: number): "High" | "Medium" | "Low" {
  if (score >= 55) return "High";
  if (score >= 30) return "Medium";
  return "Low";
}

export const statusMeta: Record<SellerStatus, { label: string; className: string; description: string }> = {
  Pending:  { label: "Pending",  className: "bg-warning/15 text-warning border-warning/30",                  description: "Retention action not yet taken" },
  Resolved: { label: "Resolved", className: "bg-success/15 text-success border-success/30",                  description: "Retention action completed" },
};

export const metricLabels: Record<keyof Seller["metrics"], string> = {
  loginPct: "Login %",
  blConsumptionPct: "BL Consumption %",
  pnsPickupRatePct: "PNS Pickup Rate %",
  lmsReplyRatePct: "LMS Reply Rate %",
  retailBlRecommendedPct: "% Retail BL Recommended",
  catalogScore: "Catalog Score",
};
