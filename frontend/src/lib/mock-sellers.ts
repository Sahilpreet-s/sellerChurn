export type MetricHistory = { month: string; value: number };

export type SellerStatus = "Pending" | "Resolved";

export type ChurnCause = "Seller Disengaged" | "External" | "Mixed";

export type SellerArchetype =
  | "Overwhelmed Starter"
  | "ROI Doubter"
  | "Platform Victim"
  | "Competitor Target"
  | "Seasonal Dip"
  | "Healthy"
  | "Seller Inactive";

export type CallSentiment = "Negative" | "Neutral" | "Positive";

export type CallInsight = {
  id: string;
  date: string;
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

export type LeadsMonthData = {
  month: string;
  blConsumed: number;
  totalEnq: number;
  cons0to4hrs: number;
  cons4to24hrs: number;
  consGt1day: number;
  blLapsed: number;
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
    blni: MetricHistory[];
    blActiveDays: MetricHistory[];
  };
  leadsHistory?: LeadsMonthData[];
  callInsights?: CallInsight[];
};

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
  "Seller Disengaged": { label: "Disengaged", className: "bg-destructive/15 text-destructive border-destructive/30", owner: "Sales Exec",          description: "Seller withdrawing from platform — exec owns recovery" },
  "External":          { label: "External",   className: "bg-primary/15 text-primary border-primary/30",             owner: "Sales Manager",        description: "Competitor or market pressure — loop in Sales Manager" },
  "Mixed":             { label: "Mixed",      className: "bg-muted text-muted-foreground border-border",             owner: "Sales Manager + Exec", description: "Multiple causes — requires joint call" },
};

export const archetypeMeta: Record<SellerArchetype, { emoji: string; description: string }> = {
  "Overwhelmed Starter": { emoji: "🟥", description: "New or re-acquired seller who never properly onboarded" },
  "ROI Doubter":         { emoji: "🟧", description: "Declining ROI perception — needs value demonstration" },
  "Platform Victim":     { emoji: "🟨", description: "Platform issue (BL filter, PNS, catalog) causing frustration" },
  "Competitor Target":   { emoji: "🟦", description: "Actively comparing or negotiating with a competitor" },
  "Seasonal Dip":        { emoji: "🟩", description: "Decline is seasonal — score dampened, monitor closely" },
  "Healthy":             { emoji: "⬜", description: "Engaged seller — upsell opportunity" },
  "Seller Inactive":     { emoji: "⬛", description: "Zero platform engagement — immediate exec intervention required" },
};

export const metricLabels: Record<keyof Seller["metrics"], string> = {
  loginPct:               "Login %",
  blConsumptionPct:       "BL Consumption %",
  pnsPickupRatePct:       "PNS Pickup Rate %",
  lmsReplyRatePct:        "LMS Reply Rate %",
  retailBlRecommendedPct: "% Retail BL Recommended",
  catalogScore:           "Catalog Score",
  cqs:                    "Content Quality Score",
  blni:                   "BLNI %",
  blActiveDays:           "Active Days",
};

// Keys that display as raw counts (no % suffix, not charted on 0-100 axis)
export const countMetrics = new Set<keyof Seller["metrics"]>(["blActiveDays"]);
