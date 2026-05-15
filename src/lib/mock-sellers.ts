export type MetricHistory = { month: string; value: number };

export type SellerStatus = "Pending" | "Resolved";

export type ChurnCause = "BEHAVIORAL" | "PLATFORM_FAILURE" | "EXTERNAL" | "MIXED";

export type SellerArchetype =
  | "Overwhelmed Starter"
  | "ROI Doubter"
  | "Platform Victim"
  | "Competitor Target"
  | "Seasonal Dip"
  | "Healthy";

export type CallSentiment = "Negative" | "Neutral" | "Positive";

export type CallInsight = {
  id: string;
  date: string; // YYYY-MM-DD
  durationMin: number;
  agent: string;
  sentiment: CallSentiment;
  summary: string;
  issues: string[];
  quote?: string;
  disposition?: "Willing" | "Skeptical" | "Hostile";
  competitorMentioned?: string;
  commitmentByExec?: string;
  source?: "AUDIO" | "MERP" | "MANUAL";
};

export type Seller = {
  id: string;
  name: string;
  company: string;
  city: string;
  category: string;
  packageType: "Catalog" | "Silver" | "Gold" | "Platinum" | "Star";
  renewalDate: string;
  daysToRenewal: number;
  arr: number;
  status: SellerStatus;
  riskScore: number;
  priorChurn: boolean;
  churnCause: ChurnCause;
  churnCauseReason: string;
  archetype: SellerArchetype;
  metrics: {
    loginPct: MetricHistory[];
    blConsumptionPct: MetricHistory[];
    pnsPickupRatePct: MetricHistory[];
    lmsReplyRatePct: MetricHistory[];
    retailBlRecommendedPct: MetricHistory[];
    catalogScore: MetricHistory[];
    cqs: MetricHistory[];
  };
  callInsights?: CallInsight[];
};

const months = ["Mar", "Apr", "May"];

function jitter(seed: number, i: number): number {
  const x = Math.sin(seed * 9301 + i * 49297) * 233280;
  return Math.round((x - Math.floor(x)) * 6 - 3);
}

function trend(seed: number, start: number, delta: number): MetricHistory[] {
  return months.map((m, i) => ({
    month: m,
    value: Math.max(0, Math.min(100, start + delta * i + jitter(seed, i))),
  }));
}

const RENEWAL_DATE = "2026-08-13";
const DAYS_TO_RENEWAL = 90;

type RawSeller = Omit<Seller, "riskScore" | "renewalDate" | "daysToRenewal" | "churnCause" | "churnCauseReason" | "archetype">;

// ─── Scoring ────────────────────────────────────────────────────────────────

function latest(h: MetricHistory[]) { return h[h.length - 1].value; }
function trendDrop(h: MetricHistory[]) { return h[0].value - h[h.length - 1].value; }

function calcRisk(s: RawSeller): number {
  const m = s.metrics;
  const loginRisk    = (100 - latest(m.loginPct))           * 0.15 + Math.max(0, trendDrop(m.loginPct))           * 0.35;
  const blRisk       = (100 - latest(m.blConsumptionPct))   * 0.15 + Math.max(0, trendDrop(m.blConsumptionPct))   * 0.35;
  const pnsRisk      = (100 - latest(m.pnsPickupRatePct))   * 0.12 + Math.max(0, trendDrop(m.pnsPickupRatePct))   * 0.30;
  const lmsRisk      = (100 - latest(m.lmsReplyRatePct))    * 0.12 + Math.max(0, trendDrop(m.lmsReplyRatePct))    * 0.30;
  const retailRisk   = latest(m.retailBlRecommendedPct)     * 0.12;
  const catalogRisk  = (100 - latest(m.catalogScore))       * 0.06;
  const cqsRisk      = (100 - latest(m.cqs))                * 0.08;

  let score = Math.min(100, Math.round(loginRisk + blRisk + pnsRisk + lmsRisk + retailRisk + catalogRisk + cqsRisk));

  // Prior churn is the strongest single predictor
  if (s.priorChurn) score = Math.min(100, Math.round(score * 1.30));

  // Seasonality dampener: Scaffolding/Construction category dips naturally in Mar-May
  const lastMonth = m.loginPct[m.loginPct.length - 1].month;
  if (
    (s.category.includes("Scaffold") || s.category.includes("Construction")) &&
    (lastMonth === "Mar" || lastMonth === "Apr" || lastMonth === "May")
  ) {
    score = Math.min(100, Math.round(score * 0.85));
  }

  return score;
}

// ─── Churn Cause ────────────────────────────────────────────────────────────

function calcChurnCause(s: RawSeller): ChurnCause {
  const m = s.metrics;
  const hasCompetitor  = (s.callInsights ?? []).some(c => c.competitorMentioned);
  const hasPlatformIssue = (s.callInsights ?? []).some(c =>
    c.issues.some(i => ["BL filters not working", "Catalog edits rejected", "PNS routing", "Drop in enquiries", "Lead quality dropped"].includes(i))
  );
  const highRetail     = latest(m.retailBlRecommendedPct) > 52;
  const allDecline     = trendDrop(m.loginPct) > 10 && trendDrop(m.blConsumptionPct) > 10 && trendDrop(m.pnsPickupRatePct) > 8;

  if (hasCompetitor && !hasPlatformIssue && !highRetail) return "EXTERNAL";
  if ((hasPlatformIssue || highRetail) && !hasCompetitor && !allDecline) return "PLATFORM_FAILURE";
  if (allDecline && !hasCompetitor && !hasPlatformIssue && !highRetail) return "BEHAVIORAL";
  return "MIXED";
}

function buildChurnCauseReason(s: RawSeller, cause: ChurnCause): string {
  const m = s.metrics;
  switch (cause) {
    case "BEHAVIORAL":
      return `Login −${trendDrop(m.loginPct).toFixed(0)}%, BL −${trendDrop(m.blConsumptionPct).toFixed(0)}%, PNS −${trendDrop(m.pnsPickupRatePct).toFixed(0)}% over 3 months — disengagement pattern, no platform trigger`;
    case "PLATFORM_FAILURE":
      return latest(m.retailBlRecommendedPct) > 52
        ? `${latest(m.retailBlRecommendedPct).toFixed(0)}% of recommended BLs are retail — BL filter mismatch likely a platform config issue`
        : `Seller reported platform issues (BL filters / PNS routing / catalog edits) on calls — escalate to Product`;
    case "EXTERNAL":
      const comp = (s.callInsights ?? []).find(c => c.competitorMentioned)?.competitorMentioned;
      return comp ? `Competitor "${comp}" mentioned on call — pricing or feature comparison driving exit risk` : "Competitor pricing offer mentioned — external pressure driving exit risk";
    case "MIXED":
      return `Combination of behavioural decline and ${latest(m.retailBlRecommendedPct) > 52 ? "lead-fit mismatch" : "call-based complaints"} — requires Sales Manager coordination`;
  }
}

// ─── Archetype ──────────────────────────────────────────────────────────────

function calcArchetype(s: RawSeller): SellerArchetype {
  const m = s.metrics;
  const hasCompetitor  = (s.callInsights ?? []).some(c => c.competitorMentioned);
  const hasPlatformIssue = (s.callInsights ?? []).some(c =>
    c.issues.some(i => ["BL filters not working", "Catalog edits rejected", "PNS routing", "Drop in enquiries"].includes(i))
  );
  if (latest(m.loginPct) > 78 && latest(m.blConsumptionPct) > 60) return "Healthy";
  if (s.priorChurn && latest(m.catalogScore) < 50) return "Overwhelmed Starter";
  if (hasCompetitor) return "Competitor Target";
  if (hasPlatformIssue || latest(m.retailBlRecommendedPct) > 52) return "Platform Victim";
  if (s.category.includes("Scaffold") || s.category.includes("Construction")) return "Seasonal Dip";
  return "ROI Doubter";
}

// ─── Seller Data ─────────────────────────────────────────────────────────────

const sellersRaw: RawSeller[] = [
  // ── CRITICAL: Prior Churn ──────────────────────────────────────────────────
  {
    id: "S-20001", name: "Arjun Verma", company: "Verma Construction Supplies", city: "Delhi",
    category: "Construction Materials", packageType: "Catalog", arr: 35000, status: "Pending", priorChurn: true,
    metrics: {
      loginPct:             trend(1,   38, -8),
      blConsumptionPct:     trend(2,   28, -9),
      pnsPickupRatePct:     trend(3,   45, -13),
      lmsReplyRatePct:      trend(4,   30, -8),
      retailBlRecommendedPct: trend(5, 38,  2),
      catalogScore:         trend(6,   32,  1),
      cqs:                  trend(7,   30,  1),
    },
    callInsights: [],
  },
  {
    id: "S-20002", name: "Deepa Krishnan", company: "Krishna Beverages Pvt Ltd", city: "Bengaluru",
    category: "Packaged Drinking Water", packageType: "Catalog", arr: 35000, status: "Pending", priorChurn: true,
    metrics: {
      loginPct:             trend(10,  42, -11),
      blConsumptionPct:     trend(11,  32, -10),
      pnsPickupRatePct:     trend(12,  52, -14),
      lmsReplyRatePct:      trend(13,  38, -12),
      retailBlRecommendedPct: trend(14, 28,  2),
      catalogScore:         trend(15,  40,  3),
      cqs:                  trend(16,  35,  3),
    },
    callInsights: [
      {
        id: "C1", date: "2026-05-08", durationMin: 9, agent: "Anita R.", sentiment: "Negative", source: "MERP",
        summary: "Seller frustrated — not getting any buyer enquiries despite 2 months on platform.",
        issues: ["No buyer enquiries", "Catalog visibility concern", "ROI disappointment"],
        quote: "I paid for Catalog but haven't got a single order. What am I paying for?",
        disposition: "Hostile", competitorMentioned: undefined, commitmentByExec: "Will escalate catalog indexing to Product team",
      },
    ],
  },
  {
    id: "S-20003", name: "Suresh Yadav", company: "Yadav Poly Solutions", city: "Nagpur",
    category: "Plastic Raw Material", packageType: "Silver", arr: 55000, status: "Pending", priorChurn: true,
    metrics: {
      loginPct:             trend(20,  55, -7),
      blConsumptionPct:     trend(21,  48, -10),
      pnsPickupRatePct:     trend(22,  58, -10),
      lmsReplyRatePct:      trend(23,  52, -10),
      retailBlRecommendedPct: trend(24, 55,  4),
      catalogScore:         trend(25,  48,  2),
      cqs:                  trend(26,  44,  2),
    },
    callInsights: [
      {
        id: "C1", date: "2026-05-10", durationMin: 16, agent: "Rahul S.", sentiment: "Negative", source: "MERP",
        summary: "Platform sending retail buyers to a raw-material wholesaler. BL filters not working as configured.",
        issues: ["BL filters not working", "Lead quality dropped", "Catalog edits rejected"],
        quote: "I sell in tonnes to factories. Why am I getting calls from small shops?",
        disposition: "Skeptical", competitorMentioned: undefined, commitmentByExec: "Raised BL filter ticket with product team",
      },
      {
        id: "C2", date: "2026-04-15", durationMin: 8, agent: "Rahul S.", sentiment: "Negative", source: "MERP",
        summary: "Follow-up on BL filter issue — not yet resolved. Seller growing impatient.",
        issues: ["BL filters not working"],
        disposition: "Hostile",
      },
    ],
  },
  {
    id: "S-20004", name: "Rajesh Kumar", company: "Kumar Papers & Stationery", city: "Kolkata",
    category: "Paper & Stationery", packageType: "Catalog", arr: 35000, status: "Pending", priorChurn: true,
    metrics: {
      loginPct:             trend(30,  48, -12),
      blConsumptionPct:     trend(31,  38, -12),
      pnsPickupRatePct:     trend(32,  50, -11),
      lmsReplyRatePct:      trend(33,  42, -10),
      retailBlRecommendedPct: trend(34, 32,  3),
      catalogScore:         trend(35,  36,  2),
      cqs:                  trend(36,  32,  3),
    },
    callInsights: [
      {
        id: "C1", date: "2026-05-03", durationMin: 14, agent: "Priya D.", sentiment: "Negative", source: "AUDIO",
        summary: "Seller evaluating IndiaTrade offer. Feels IndiaMART not delivering ROI at current price.",
        issues: ["Competitor offer received", "Pricing vs ROI", "Low enquiry volume"],
        quote: "IndiaTrade is giving me a 3-month trial free. Why would I renew here?",
        disposition: "Hostile", competitorMentioned: "IndiaTrade", commitmentByExec: "Will discuss package options and loyalty discount",
      },
    ],
  },

  // ── HIGH RISK ─────────────────────────────────────────────────────────────
  {
    id: "S-10293", name: "Rakesh Sharma", company: "Sharma Industries", city: "Delhi",
    category: "Industrial Supplies", packageType: "Platinum", arr: 185000, status: "Pending", priorChurn: false,
    metrics: {
      loginPct:             trend(40,  78, -15),
      blConsumptionPct:     trend(41,  85, -20),
      pnsPickupRatePct:     trend(42,  72, -12),
      lmsReplyRatePct:      trend(43,  65, -18),
      retailBlRecommendedPct: trend(44, 40,  3),
      catalogScore:         trend(45,  70, -8),
      cqs:                  trend(46,  68, -8),
    },
    callInsights: [
      {
        id: "C1", date: "2026-04-28", durationMin: 14, agent: "Anita R.", sentiment: "Negative", source: "MERP",
        summary: "Seller frustrated with poor lead quality and unanswered support tickets.",
        issues: ["Lead quality dropped", "Support response slow", "Considering competitor"],
        quote: "I'm paying Platinum money but most leads are retail buyers wasting my time.",
        disposition: "Skeptical", competitorMentioned: undefined, commitmentByExec: "Will review BL filter config and prioritise support ticket",
      },
      {
        id: "C2", date: "2026-03-15", durationMin: 9, agent: "Vikas K.", sentiment: "Neutral", source: "MERP",
        summary: "Discussed BL filter tuning. Seller agreed to try but skeptical.",
        issues: ["BL filters not working"], disposition: "Skeptical",
      },
    ],
  },
  {
    id: "S-10847", name: "Priya Mehta", company: "Mehta Textiles", city: "Surat",
    category: "Textiles & Fabrics", packageType: "Gold", arr: 95000, status: "Pending", priorChurn: false,
    metrics: {
      loginPct:             trend(50,  45, -10),
      blConsumptionPct:     trend(51,  50, -15),
      pnsPickupRatePct:     trend(52,  40, -8),
      lmsReplyRatePct:      trend(53,  35, -10),
      retailBlRecommendedPct: trend(54, 60,  5),
      catalogScore:         trend(55,  55, -5),
      cqs:                  trend(56,  52, -5),
    },
    callInsights: [
      {
        id: "C1", date: "2026-04-22", durationMin: 11, agent: "Anita R.", sentiment: "Negative", source: "MERP",
        summary: "Seller says enquiries dropped sharply. Blames algorithm changes for poor BL relevance.",
        issues: ["Drop in enquiries", "Catalog visibility concern"],
        quote: "Last 2 months I'm getting half the calls I used to get.",
        disposition: "Skeptical", competitorMentioned: undefined, commitmentByExec: "Scheduled catalog audit for next week",
      },
    ],
  },
  {
    id: "S-12889", name: "Vikram Singh", company: "Singh Electricals", city: "Ludhiana",
    category: "Electrical Equipment", packageType: "Gold", arr: 110000, status: "Pending", priorChurn: false,
    metrics: {
      loginPct:             trend(60,  35, -12),
      blConsumptionPct:     trend(61,  40, -18),
      pnsPickupRatePct:     trend(62,  30, -10),
      lmsReplyRatePct:      trend(63,  25, -8),
      retailBlRecommendedPct: trend(64, 70,  5),
      catalogScore:         trend(65,  45, -10),
      cqs:                  trend(66,  42, -10),
    },
    callInsights: [
      {
        id: "C1", date: "2026-05-02", durationMin: 22, agent: "Priya D.", sentiment: "Negative", source: "AUDIO",
        summary: "Seller threatening to switch to TradeIndia. Multiple complaints unresolved for 60+ days.",
        issues: ["Competitor offer received", "Buyer disputes unhandled", "Catalog edits rejected"],
        quote: "TradeIndia is offering me same package at 30% less. Why should I stay?",
        disposition: "Hostile", competitorMentioned: "TradeIndia", commitmentByExec: "Escalated to Sales Manager. Pricing review in progress.",
      },
      {
        id: "C2", date: "2026-04-10", durationMin: 7, agent: "Priya D.", sentiment: "Negative", source: "MERP",
        summary: "Seller upset about PNS missed calls — wants better call routing.",
        issues: ["PNS routing"], disposition: "Skeptical",
      },
    ],
  },
  {
    id: "S-14021", name: "Mohammed Khan", company: "Khan Hardware Co", city: "Mumbai",
    category: "Hardware", packageType: "Gold", arr: 125000, status: "Pending", priorChurn: false,
    metrics: {
      loginPct:             trend(70,  55, -10),
      blConsumptionPct:     trend(71,  60, -12),
      pnsPickupRatePct:     trend(72,  48, -8),
      lmsReplyRatePct:      trend(73,  40, -10),
      retailBlRecommendedPct: trend(74, 55,  3),
      catalogScore:         trend(75,  58, -6),
      cqs:                  trend(76,  55, -6),
    },
    callInsights: [
      {
        id: "C1", date: "2026-04-18", durationMin: 12, agent: "Vikas K.", sentiment: "Neutral", source: "MERP",
        summary: "Seller wants help refreshing catalog images. Open to retention if platform helps.",
        issues: ["Needs catalog support"], disposition: "Willing", commitmentByExec: "Arranged free catalog photo session",
      },
    ],
  },
  {
    id: "S-15203", name: "Rohit Iyer", company: "Iyer Auto Parts", city: "Chennai",
    category: "Automotive", packageType: "Gold", arr: 105000, status: "Pending", priorChurn: false,
    metrics: {
      loginPct:             trend(80,  42, -14),
      blConsumptionPct:     trend(81,  48, -16),
      pnsPickupRatePct:     trend(82,  38, -10),
      lmsReplyRatePct:      trend(83,  32, -8),
      retailBlRecommendedPct: trend(84, 65,  5),
      catalogScore:         trend(85,  50, -8),
      cqs:                  trend(86,  48, -8),
    },
    callInsights: [
      {
        id: "C1", date: "2026-04-25", durationMin: 16, agent: "Anita R.", sentiment: "Negative", source: "AUDIO",
        summary: "Frustrated with LMS UI — team cannot keep up with replies. Losing leads daily.",
        issues: ["LMS hard to use", "Team training gap", "Lead reply delays"],
        quote: "My staff doesn't understand the new LMS. We're losing leads daily.",
        disposition: "Skeptical", competitorMentioned: undefined, commitmentByExec: "Scheduled LMS training session for seller's team",
      },
    ],
  },
  {
    id: "S-12104", name: "Sunita Reddy", company: "Reddy Chemicals", city: "Hyderabad",
    category: "Chemicals", packageType: "Platinum", arr: 215000, status: "Pending", priorChurn: false,
    metrics: {
      loginPct:             trend(90,  60, -8),
      blConsumptionPct:     trend(91,  70, -10),
      pnsPickupRatePct:     trend(92,  55, -6),
      lmsReplyRatePct:      trend(93,  50, -7),
      retailBlRecommendedPct: trend(94, 45,  2),
      catalogScore:         trend(95,  65, -4),
      cqs:                  trend(96,  62, -4),
    },
    callInsights: [
      {
        id: "C1", date: "2026-04-30", durationMin: 18, agent: "Rahul S.", sentiment: "Negative", source: "MERP",
        summary: "Pricing complaint — renewal cost up 20% but orders haven't grown proportionally.",
        issues: ["Pricing vs ROI", "Wants discount on renewal"],
        quote: "Renewal cost has gone up 20% but my orders haven't.",
        disposition: "Skeptical", competitorMentioned: undefined, commitmentByExec: "Requested loyalty discount approval from management",
      },
    ],
  },

  // ── MEDIUM RISK ───────────────────────────────────────────────────────────
  {
    id: "S-20005", name: "Deepak Malhotra", company: "Malhotra Scaffold Works", city: "Chandigarh",
    category: "Scaffolding & Formwork", packageType: "Gold", arr: 98000, status: "Pending", priorChurn: false,
    metrics: {
      loginPct:             trend(100, 72, -5),
      blConsumptionPct:     trend(101, 62, -8),
      pnsPickupRatePct:     trend(102, 68, -6),
      lmsReplyRatePct:      trend(103, 65, -6),
      retailBlRecommendedPct: trend(104, 28, 1),
      catalogScore:         trend(105, 70, -2),
      cqs:                  trend(106, 67, -2),
    },
    callInsights: [
      {
        id: "C1", date: "2026-05-06", durationMin: 10, agent: "Vikas K.", sentiment: "Neutral", source: "MERP",
        summary: "Seller acknowledges seasonal slowdown in construction activity Mar–May. Expects recovery in June.",
        issues: ["Seasonal low order volume"],
        disposition: "Willing", commitmentByExec: "Deferred renewal discussion to June when season picks up",
      },
    ],
  },
  {
    id: "S-20006", name: "Meera Shah", company: "Shah Food Machines", city: "Vadodara",
    category: "Food Processing Equipment", packageType: "Silver", arr: 62000, status: "Pending", priorChurn: false,
    metrics: {
      loginPct:             trend(110, 65, -8),
      blConsumptionPct:     trend(111, 55, -8),
      pnsPickupRatePct:     trend(112, 62, -8),
      lmsReplyRatePct:      trend(113, 58, -8),
      retailBlRecommendedPct: trend(114, 42, 2),
      catalogScore:         trend(115, 62, -2),
      cqs:                  trend(116, 60, -2),
    },
    callInsights: [
      {
        id: "C1", date: "2026-04-20", durationMin: 11, agent: "Anita R.", sentiment: "Neutral", source: "MERP",
        summary: "Seller not seeing enough B2B food-factory buyers. ROI concerns but willing to continue if improved.",
        issues: ["Buyer quality concern", "ROI disappointment"],
        disposition: "Willing", commitmentByExec: "Will recalibrate BL category filters to exclude retail food buyers",
      },
    ],
  },
  {
    id: "S-20007", name: "Sanjay Tiwari", company: "Tiwari Pharma Ingredients", city: "Indore",
    category: "Pharma Raw Materials", packageType: "Platinum", arr: 175000, status: "Pending", priorChurn: false,
    metrics: {
      loginPct:             trend(120, 68, -5),
      blConsumptionPct:     trend(121, 62, -7),
      pnsPickupRatePct:     trend(122, 70, -8),
      lmsReplyRatePct:      trend(123, 65, -7),
      retailBlRecommendedPct: trend(124, 56, 2),
      catalogScore:         trend(125, 64, -2),
      cqs:                  trend(126, 62, -2),
    },
    callInsights: [
      {
        id: "C1", date: "2026-05-01", durationMin: 13, agent: "Rahul S.", sentiment: "Negative", source: "MERP",
        summary: "Getting retail pharmacy leads despite being a bulk API/ingredient supplier.",
        issues: ["Lead quality dropped", "BL filters not working"],
        quote: "I need bulk pharma buyers, not medical shops. Fix the filter or I'm leaving.",
        disposition: "Skeptical", competitorMentioned: undefined, commitmentByExec: "Raised P1 BL filter ticket for pharma category",
      },
    ],
  },
  {
    id: "S-20008", name: "Pooja Bansal", company: "Bansal IT Distributors", city: "Noida",
    category: "IT Hardware & Peripherals", packageType: "Gold", arr: 115000, status: "Pending", priorChurn: false,
    metrics: {
      loginPct:             trend(130, 72, -6),
      blConsumptionPct:     trend(131, 65, -8),
      pnsPickupRatePct:     trend(132, 70, -7),
      lmsReplyRatePct:      trend(133, 68, -7),
      retailBlRecommendedPct: trend(134, 38, 2),
      catalogScore:         trend(135, 66, -2),
      cqs:                  trend(136, 65, -2),
    },
    callInsights: [
      {
        id: "C1", date: "2026-04-29", durationMin: 15, agent: "Priya D.", sentiment: "Negative", source: "AUDIO",
        summary: "Received IndiaB2B prospecting call. Comparing platform features and pricing.",
        issues: ["Competitor offer received", "Platform feature comparison"],
        quote: "IndiaB2B showed me a feature where buyers can schedule a call. Does IndiaMART have that?",
        disposition: "Skeptical", competitorMentioned: "IndiaB2B", commitmentByExec: "Highlighted PNS auto-connect as equivalent feature",
      },
    ],
  },
  {
    id: "S-15994", name: "Kavita Joshi", company: "Joshi Furniture", city: "Jaipur",
    category: "Furniture", packageType: "Silver", arr: 55000, status: "Resolved", priorChurn: false,
    metrics: {
      loginPct:             trend(140, 68, -5),
      blConsumptionPct:     trend(141, 72, -4),
      pnsPickupRatePct:     trend(142, 60, -3),
      lmsReplyRatePct:      trend(143, 58, -5),
      retailBlRecommendedPct: trend(144, 42, 1),
      catalogScore:         trend(145, 70, -2),
      cqs:                  trend(146, 68, -2),
    },
    callInsights: [
      {
        id: "C1", date: "2026-04-05", durationMin: 5, agent: "Vikas K.", sentiment: "Neutral", source: "MERP",
        summary: "Routine check-in. Seller concerned about slight dip but committed to renewal.",
        issues: [], disposition: "Willing",
      },
    ],
  },

  // ── HEALTHY / LOW RISK ────────────────────────────────────────────────────
  {
    id: "S-11532", name: "Amit Patel", company: "Patel Machine Tools", city: "Ahmedabad",
    category: "Machinery", packageType: "Star", arr: 320000, status: "Resolved", priorChurn: false,
    metrics: {
      loginPct:             trend(150, 92, -1),
      blConsumptionPct:     trend(151, 88,  1),
      pnsPickupRatePct:     trend(152, 85,  1),
      lmsReplyRatePct:      trend(153, 82,  2),
      retailBlRecommendedPct: trend(154, 24, 1),
      catalogScore:         trend(155, 90,  1),
      cqs:                  trend(156, 74,  1),
    },
    callInsights: [
      {
        id: "C1", date: "2026-04-20", durationMin: 8, agent: "Rahul S.", sentiment: "Positive", source: "MERP",
        summary: "Happy with platform performance. Asking about premium add-ons and IM Leader package.",
        issues: [], disposition: "Willing",
      },
    ],
  },
  {
    id: "S-14778", name: "Neha Gupta", company: "Gupta Plastics", city: "Pune",
    category: "Plastics", packageType: "Platinum", arr: 195000, status: "Resolved", priorChurn: false,
    metrics: {
      loginPct:             trend(160, 88,  1),
      blConsumptionPct:     trend(161, 82,  2),
      pnsPickupRatePct:     trend(162, 80,  1),
      lmsReplyRatePct:      trend(163, 78,  1),
      retailBlRecommendedPct: trend(164, 28, 0),
      catalogScore:         trend(165, 85,  2),
      cqs:                  trend(166, 82,  2),
    },
    callInsights: [
      {
        id: "C1", date: "2026-04-12", durationMin: 6, agent: "Priya D.", sentiment: "Positive", source: "MERP",
        summary: "Seller satisfied. Mentioned strong order growth this quarter.", issues: [], disposition: "Willing",
      },
    ],
  },
  {
    id: "S-13456", name: "Anjali Nair", company: "Nair Packaging", city: "Kochi",
    category: "Packaging", packageType: "Silver", arr: 65000, status: "Resolved", priorChurn: false,
    metrics: {
      loginPct:             trend(170, 80, -2),
      blConsumptionPct:     trend(171, 75, -1),
      pnsPickupRatePct:     trend(172, 78,  1),
      lmsReplyRatePct:      trend(173, 72,  0),
      retailBlRecommendedPct: trend(174, 34, 1),
      catalogScore:         trend(175, 80,  0),
      cqs:                  trend(176, 78,  0),
    },
    callInsights: [],
  },
  {
    id: "S-20009", name: "Ravi Nambiar", company: "Nambiar Automation Systems", city: "Chennai",
    category: "Industrial Automation", packageType: "Star", arr: 285000, status: "Resolved", priorChurn: false,
    metrics: {
      loginPct:             trend(180, 92,  0),
      blConsumptionPct:     trend(181, 78,  2),
      pnsPickupRatePct:     trend(182, 88,  1),
      lmsReplyRatePct:      trend(183, 85,  1),
      retailBlRecommendedPct: trend(184, 18, 0),
      catalogScore:         trend(185, 85,  1),
      cqs:                  trend(186, 82,  2),
    },
    callInsights: [
      {
        id: "C1", date: "2026-05-02", durationMin: 7, agent: "Vikas K.", sentiment: "Positive", source: "MERP",
        summary: "Seller very satisfied. Mentioned 3 large OEM orders via platform this quarter.",
        issues: [], disposition: "Willing",
      },
    ],
  },
  {
    id: "S-20010", name: "Prerna Agarwal", company: "Agarwal Industrial Chem", city: "Delhi",
    category: "Industrial Chemicals", packageType: "Platinum", arr: 210000, status: "Resolved", priorChurn: false,
    metrics: {
      loginPct:             trend(190, 88, -1),
      blConsumptionPct:     trend(191, 72,  2),
      pnsPickupRatePct:     trend(192, 82,  2),
      lmsReplyRatePct:      trend(193, 78,  2),
      retailBlRecommendedPct: trend(194, 22, 0),
      catalogScore:         trend(195, 78,  1),
      cqs:                  trend(196, 75,  1),
    },
    callInsights: [
      {
        id: "C1", date: "2026-04-28", durationMin: 9, agent: "Rahul S.", sentiment: "Positive", source: "MERP",
        summary: "Strong renewal intent. Exploring upgrade to Star package for higher BL allocation.",
        issues: [], disposition: "Willing", commitmentByExec: "Sent Star package proposal",
      },
    ],
  },
];

// ─── Derived Export ───────────────────────────────────────────────────────────

export const sellers: Seller[] = sellersRaw
  .map((s) => {
    const cause = calcChurnCause(s);
    return {
      ...s,
      renewalDate: RENEWAL_DATE,
      daysToRenewal: DAYS_TO_RENEWAL,
      riskScore: calcRisk(s),
      churnCause: cause,
      churnCauseReason: buildChurnCauseReason(s, cause),
      archetype: calcArchetype(s),
    };
  })
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
  Pending:  { label: "Pending",  className: "bg-warning/15 text-warning border-warning/30",   description: "Retention action not yet taken" },
  Resolved: { label: "Resolved", className: "bg-success/15 text-success border-success/30",   description: "Retention action completed" },
};

export const churnCauseMeta: Record<ChurnCause, { label: string; className: string; owner: string; description: string }> = {
  BEHAVIORAL:       { label: "Behavioural",   className: "bg-destructive/15 text-destructive border-destructive/30", owner: "Sales Exec",    description: "Seller disengaging — exec owns recovery" },
  PLATFORM_FAILURE: { label: "Platform",      className: "bg-warning/15 text-warning border-warning/30",             owner: "Product Team",  description: "Platform issue causing seller frustration — escalate to Product" },
  EXTERNAL:         { label: "External",      className: "bg-primary/15 text-primary border-primary/30",             owner: "Sales Manager", description: "Competitor or external pressure — loop in Sales Manager" },
  MIXED:            { label: "Mixed",         className: "bg-muted text-muted-foreground border-border",              owner: "Sales Manager + Exec", description: "Multiple causes — requires joint call" },
};

export const archetypeMeta: Record<SellerArchetype, { emoji: string; description: string }> = {
  "Overwhelmed Starter": { emoji: "🟥", description: "New or re-acquired seller who never properly onboarded" },
  "ROI Doubter":         { emoji: "🟧", description: "Declining ROI perception — needs value demonstration" },
  "Platform Victim":     { emoji: "🟨", description: "Platform issue (BL filter, PNS, catalog) causing frustration" },
  "Competitor Target":   { emoji: "🟦", description: "Actively comparing or negotiating with a competitor" },
  "Seasonal Dip":        { emoji: "🟩", description: "Decline is seasonal — score dampened, monitor closely" },
  "Healthy":             { emoji: "⬜", description: "Engaged seller — upsell opportunity" },
};

export const metricLabels: Record<keyof Seller["metrics"], string> = {
  loginPct:             "Login %",
  blConsumptionPct:     "BL Consumption %",
  pnsPickupRatePct:     "PNS Pickup Rate %",
  lmsReplyRatePct:      "LMS Reply Rate %",
  retailBlRecommendedPct: "% Retail BL Recommended",
  catalogScore:         "Catalog Score",
  cqs:                  "Content Quality Score",
};
