import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, useCallback, useEffect } from "react";
import {
  riskBand, metricLabels, statusMeta, countMetrics,
  churnCauseMeta, archetypeMeta,
  type Seller, type MetricHistory, type CallInsight, type ChurnCause,
  type LeadsMonthData,
} from "@/lib/mock-sellers";
import {
  fetchSeller, logOutcome, fetchPlaybook,
  type OutcomeBody, type PlaybookEntry,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, AlertTriangle, TrendingDown, TrendingUp, Phone, Quote,
  CheckCircle2, BookOpen,
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend } from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Constants ───────────────────────────────────────────────────────────────

const CHURN_REASONS = [
  { value: "low_lead_quality", label: "Low lead quality" },
  { value: "price",            label: "Price / ROI" },
  { value: "competitor",       label: "Competitor offer" },
  { value: "platform_issue",   label: "Platform issue" },
  { value: "no_roi",           label: "No ROI seen" },
  { value: "disengaged",       label: "Disengaged" },
  { value: "other",            label: "Other" },
] as const;

type ChurnReasonValue = (typeof CHURN_REASONS)[number]["value"];

// ─── Loader ───────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/seller/$sellerId")({
  loader: async ({ params }) => {
    try {
      const seller = await fetchSeller(params.sellerId);
      return { seller };
    } catch {
      return { seller: null };
    }
  },
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <p className="text-muted-foreground">Seller not found.</p>
        <Link to="/dashboard" search={{ view: "churn" }} className="mt-4 inline-block text-primary underline">Back to dashboard</Link>
      </div>
    </div>
  ),
  component: SellerDetail,
});

// ─── Date helpers ─────────────────────────────────────────────────────────────

const MONTHS_LABEL = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_LABEL[m - 1]} ${y}`;
}

function archetypeChipClass(archetype: string): string {
  switch (archetype) {
    case "Overwhelmed Starter": return "bg-destructive/10 text-destructive border-destructive/25";
    case "ROI Doubter":         return "bg-warning/10 text-warning border-warning/25";
    case "Platform Victim":     return "bg-yellow-500/10 text-yellow-600 border-yellow-500/25";
    case "Competitor Target":   return "bg-primary/10 text-primary border-primary/25";
    case "Seasonal Dip":        return "bg-success/10 text-success border-success/25";
    default:                    return "bg-muted text-muted-foreground border-border";
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

function SellerDetail() {
  const { seller: initialSeller } = Route.useLoaderData();
  const router = useRouter();
  const [seller, setSeller] = useState<Seller | null>(initialSeller);

  // Outcome logging state
  const [outcomeSaved, setOutcomeSaved] = useState<string | null>(null);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);
  const [outcomeLoading, setOutcomeLoading] = useState(false);
  const [totalOutcomes, setTotalOutcomes] = useState<number | null>(null);
  const [showOutcomeForm, setShowOutcomeForm] = useState(false);

  // Outcome form fields
  const [disposition, setDisposition] = useState("");
  const [churnReasons, setChurnReasons] = useState<ChurnReasonValue[]>([]);
  const [competitorMentioned, setCompetitorMentioned] = useState("");
  const [execCommitment, setExecCommitment] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [customReason, setCustomReason] = useState("");

  // Playbook from historical outcomes
  const [playbookEntry, setPlaybookEntry] = useState<PlaybookEntry | null>(null);
  const [showPlaybook, setShowPlaybook] = useState(false);


  // ── All hooks must be declared before any early return ──────────────────────

  const handleOutcome = useCallback(async (outcome: string) => {
    if (!seller || outcomeLoading) return;
    setOutcomeLoading(true);
    setOutcomeError(null);
    try {
      const body: OutcomeBody = {
        outcome,
        disposition,
        churnReasons: churnReasons.filter(r => r !== "other"),
        competitorMentioned,
        execCommitment,
        followUpDate,
        customReason,
      };
      const result = await logOutcome(seller.id, body);
      setOutcomeSaved(outcome);
      setTotalOutcomes(result.totalOutcomes);
      if (outcome === "Resolved") {
        setSeller(s => s ? { ...s, status: "Resolved" } : s);
      }
    } catch {
      setOutcomeError("Could not save outcome — check that the Go backend is running.");
    } finally {
      setOutcomeLoading(false);
    }
  }, [seller, outcomeLoading, disposition, churnReasons, competitorMentioned, execCommitment, followUpDate, customReason]);


  useEffect(() => {
    fetchPlaybook()
      .then(entries => {
        const match = entries.find(e => e.archetype === seller?.archetype);
        if (match) setPlaybookEntry(match);
      })
      .catch(() => {});
  }, [seller?.archetype]);

  // ── Early return after all hooks ────────────────────────────────────────────

  if (!seller) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Seller not found.</p>
          <Button onClick={() => router.navigate({ to: "/dashboard", search: { view: "churn" } })} className="mt-4">Back to dashboard</Button>
        </div>
      </div>
    );
  }

  const band = riskBand(seller.riskScore);
  const causeMeta = churnCauseMeta[seller.churnCause as ChurnCause] ?? {
    label: "Unknown", className: "bg-muted text-muted-foreground border-border",
    owner: "—", description: "",
  };
  const archMeta = archetypeMeta[seller.archetype as keyof typeof archetypeMeta] ?? { emoji: "⬜", description: "" };

  return (
    <div className="min-h-screen">
      <header className="border-b bg-background">
        <div className="mx-auto max-w-7xl px-6 pt-3 pb-4">
          <Link to="/dashboard" search={{ view: "churn" }} className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground mb-2">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Link>

          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-bold ring-2 ${band === "High" ? "from-destructive/30 to-destructive/10 text-destructive ring-destructive/40 risk-high-badge" : band === "Medium" ? "from-warning/30 to-warning/10 text-warning ring-warning/40" : "from-success/30 to-success/10 text-success ring-success/30"}`}>
              {seller.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
              {seller.priorChurn && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive border-2 border-background flex items-center justify-center text-[8px] text-destructive-foreground font-bold" title="Prior churn">!</span>
              )}
            </div>

            {/* Identity */}
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight leading-tight">{seller.name}</h1>
              <p className="text-xs text-muted-foreground">{seller.company} · {seller.city}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-xs font-medium">{seller.packageType}</Badge>
                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${statusMeta[seller.status as keyof typeof statusMeta]?.className ?? ""}`}>{seller.status}</span>
                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${causeMeta.className}`} title={causeMeta.description}>{causeMeta.label}</span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${archetypeChipClass(seller.archetype)}`} title={archMeta.description}>
                  {archMeta.emoji} {seller.archetype}
                </span>
                {(() => {
                  const days = seller.metrics.blActiveDays ?? [];
                  const v = days.length > 0 ? days[days.length - 1].value : null;
                  return v !== null ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className={`h-1.5 w-1.5 rounded-full ${v >= 20 ? "bg-success" : v >= 10 ? "bg-warning" : "bg-destructive"}`} />
                      {v}d active
                    </span>
                  ) : null;
                })()}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        {/* Prior churn warning */}
        {seller.priorChurn && (
          <div className="flex items-start gap-3 rounded-xl border-l-4 border-destructive bg-destructive/5 px-4 py-3 text-sm animate-slide-in-left">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-destructive">Prior churn detected</p>
              <p className="text-muted-foreground mt-0.5">
                Previously on a Free/lapsed plan before re-acquiring. Prior churn is the strongest single predictor of repeat churn — risk elevated 30%. Treat as critical regardless of current signal levels.
              </p>
            </div>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Risk score */}
          <Card className={`animate-slide-in-up transition-all duration-200 hover:-translate-y-1 hover:shadow-lg cursor-default select-none ${band === "High" ? "border-destructive/40 bg-destructive/5" : band === "Medium" ? "border-warning/40 bg-warning/5" : "border-success/40 bg-success/5"}`}>
            <CardContent className="pt-6 pb-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                <AlertTriangle className="h-4 w-4" /> Risk score
              </div>
              <div className="flex items-end gap-1.5">
                <p className="text-5xl font-semibold tracking-tight leading-none">{seller.riskScore}</p>
                <p className="text-xl text-muted-foreground leading-none mb-0.5">/100</p>
              </div>
              <p className={`mt-2 text-sm font-medium ${band === "High" ? "text-destructive" : band === "Medium" ? "text-warning" : "text-success"}`}>{band} risk of churn</p>
              <div className="mt-4 h-1.5 rounded-full bg-muted/60 overflow-hidden">
                <div
                  className={`h-full rounded-full animate-bar-fill ${band === "High" ? "bg-destructive" : band === "Medium" ? "bg-warning" : "bg-success"}`}
                  style={{ width: `${seller.riskScore}%` }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Renewal date */}
          <Card className="animate-slide-in-up transition-all duration-200 hover:-translate-y-1 hover:shadow-lg cursor-default select-none" style={{ animationDelay: '80ms' }}>
            <CardContent className="pt-6 pb-6">
              <p className="text-sm text-muted-foreground mb-3">Renewal date</p>
              <p className="text-3xl font-semibold tracking-tight">{fmtDate(seller.renewalDate)}</p>
              <p className={`mt-2 text-sm font-medium ${seller.daysToRenewal <= 30 ? "text-destructive" : seller.daysToRenewal <= 60 ? "text-warning" : "text-muted-foreground"}`}>
                in {seller.daysToRenewal} days
              </p>
              <div className="mt-4 h-1.5 rounded-full bg-muted/60 overflow-hidden">
                <div
                  className={`h-full rounded-full animate-bar-fill ${seller.daysToRenewal <= 30 ? "bg-destructive" : seller.daysToRenewal <= 60 ? "bg-warning" : "bg-primary/50"}`}
                  style={{ width: `${Math.min(100, Math.max(5, 100 - (Math.max(0, seller.daysToRenewal) / 180) * 100))}%`, animationDelay: '300ms' }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Annual revenue */}
          <Card className="animate-slide-in-up transition-all duration-200 hover:-translate-y-1 hover:shadow-lg cursor-default select-none" style={{ animationDelay: '160ms' }}>
            <CardContent className="pt-6 pb-6">
              <p className="text-sm text-muted-foreground mb-3">Annual revenue</p>
              <p className="text-3xl font-semibold tracking-tight">₹{(seller.arr / 1000).toFixed(0)}k</p>
              <p className="mt-2 text-sm text-muted-foreground">{seller.category}</p>
              <p className="mt-1 text-xs text-muted-foreground">{seller.packageType} package · {causeMeta.owner}</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="behavior">
          <TabsList className="h-auto flex-wrap gap-2 bg-transparent p-0">
            {[
              ["behavior", "Past behaviour"],
              ["leads", "IndiaMART Leads"],
              ["flagged", "Why flagged"],
              ["calls", "Call insights"],
              ["guide", "Retention guide"],
            ].map(([v, label]) => (
              <TabsTrigger key={v} value={v} className="rounded-lg border bg-background px-4 py-2 text-foreground shadow-sm transition-all duration-150 hover:bg-muted hover:scale-[1.02] data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:border-foreground data-[state=active]:shadow-md data-[state=active]:scale-[1.02]">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── Past behaviour ── */}
          <TabsContent value="behavior" className="mt-4">
            <h2 className="mb-4 text-lg font-semibold tracking-tight">Behavior — past 3 months</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(Object.keys(seller.metrics) as Array<keyof Seller["metrics"]>)
                .filter((key) => key !== "blActiveDays")
                .map((key) => (
                  <MetricCard
                    key={key}
                    label={metricLabels[key]}
                    data={seller.metrics[key] ?? []}
                    invert={key === "retailBlRecommendedPct" || key === "blni"}
                    isCount={countMetrics.has(key)}
                  />
                ))}
            </div>
          </TabsContent>

          {/* ── Leads chart ── */}
          <TabsContent value="leads" className="mt-4">
            <h2 className="mb-1 text-lg font-semibold tracking-tight">IndiaMART leads — past 6 months</h2>
            <p className="mb-4 text-sm text-muted-foreground">Monthly volume of buyer enquiries, Buy-Leads consumed, and lead consumption timing.</p>
            <LeadsChart data={seller.leadsHistory ?? []} />
          </TabsContent>

          {/* ── Why flagged ── */}
          <TabsContent value="flagged" className="mt-4">
            <h2 className="mb-4 text-lg font-semibold tracking-tight">Why this seller is flagged</h2>
            <Card>
              <CardContent className="pt-6">
                <ul className="space-y-2 text-sm">
                  {buildReasons(seller).map((r, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Call insights ── */}
          <TabsContent value="calls" className="mt-4">
            <div className="mb-4">
              <h2 className="text-lg font-semibold tracking-tight">Sales call insights</h2>
              <p className="text-sm text-muted-foreground">Issues raised by seller in calls — surfaced as churn drivers.</p>
            </div>
            <CallInsightsList insights={seller.callInsights ?? []} />
          </TabsContent>

          {/* ── Retention guide ── */}
          <TabsContent value="guide" className="mt-4">
            <div className="mb-4">
              <h2 className="text-lg font-semibold tracking-tight">How to retain {seller.name}</h2>
              <p className="text-sm text-muted-foreground">Personalized playbook based on this seller's signals.</p>
            </div>

            {/* Playbook from similar historical cases */}
            {playbookEntry && (
              <Card className="mb-4 border-primary/25 bg-primary/5">
                <CardContent className="pt-4 pb-4 space-y-3">
                  <button
                    onClick={() => setShowPlaybook(p => !p)}
                    className="w-full flex items-center justify-between gap-2 text-left"
                  >
                    <p className="text-sm font-semibold flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-primary" />
                      Playbook: {playbookEntry.archetype}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {playbookEntry.sampleSize} similar cases · {Math.round(playbookEntry.retentionRate * 100)}% retained
                      <span className="ml-2">{showPlaybook ? "▲" : "▼"}</span>
                    </span>
                  </button>
                  {showPlaybook && (
                    <>
                  {playbookEntry.keyInsight && (
                    <p className="text-sm text-muted-foreground italic border-l-2 border-primary/30 pl-3">
                      "{playbookEntry.keyInsight}"
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    {playbookEntry.winningApproaches.length > 0 && (
                      <div>
                        <p className="font-semibold text-success mb-1.5">What works</p>
                        <ul className="space-y-1">
                          {playbookEntry.winningApproaches.slice(0, 4).map((w, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
                              <span className="text-success shrink-0 mt-0.5">✓</span> {w}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {playbookEntry.doNotDo.length > 0 && (
                      <div>
                        <p className="font-semibold text-destructive mb-1.5">Avoid</p>
                        <ul className="space-y-1">
                          {playbookEntry.doNotDo.slice(0, 4).map((d, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
                              <span className="text-destructive shrink-0 mt-0.5">✗</span> {d}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            <RetentionGuide seller={seller} />

            {/* Outcome logging form */}
            {outcomeSaved ? (
              <div className="mt-6 rounded-md border border-success/40 bg-success/5 px-4 py-3 text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                <span>
                  <span className="font-medium">Outcome logged: {outcomeSaved}.</span>
                  {totalOutcomes !== null && ` ${totalOutcomes} training examples collected.`}
                </span>
              </div>
            ) : (
              <div className="mt-6 border-t pt-5">
                {!showOutcomeForm ? (
                  <Button variant="outline" onClick={() => setShowOutcomeForm(true)} className="w-full">
                    Log call outcome
                  </Button>
                ) : (
              <div className="space-y-4">
                <p className="text-sm font-semibold">Log call outcome</p>

                {/* Disposition */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Seller disposition on the call</p>
                  <div className="flex gap-2">
                    {(["Willing", "Skeptical", "Hostile"] as const).map(d => (
                      <button key={d}
                        onClick={() => setDisposition(prev => prev === d ? "" : d)}
                        className={`flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                          disposition === d
                            ? d === "Willing"   ? "bg-success/10 border-success/40 text-success font-medium"
                            : d === "Skeptical" ? "bg-warning/10 border-warning/40 text-warning font-medium"
                            :                    "bg-destructive/10 border-destructive/40 text-destructive font-medium"
                            : "border-border text-muted-foreground hover:bg-muted"
                        }`}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Churn reasons */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Issues raised (select all that apply)</p>
                  <div className="flex flex-wrap gap-2">
                    {CHURN_REASONS.map(({ value, label }) => (
                      <button key={value}
                        onClick={() => setChurnReasons(prev =>
                          prev.includes(value) ? prev.filter(r => r !== value) : [...prev, value]
                        )}
                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                          churnReasons.includes(value)
                            ? "bg-primary/10 border-primary/40 text-primary font-medium"
                            : "border-border text-muted-foreground hover:bg-muted"
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {churnReasons.includes("competitor") && (
                  <input
                    placeholder="Competitor name (e.g. TradeIndia)"
                    value={competitorMentioned}
                    onChange={e => setCompetitorMentioned(e.target.value)}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm bg-background"
                  />
                )}

                {churnReasons.includes("other") && (
                  <input
                    placeholder="Describe the issue..."
                    value={customReason}
                    onChange={e => setCustomReason(e.target.value)}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm bg-background"
                  />
                )}

                <Textarea
                  placeholder="What did you commit to the seller? e.g. 'BL filter ticket raised. Manual lead forwarding weekly until fix. ETA 2 weeks.'"
                  value={execCommitment}
                  onChange={e => setExecCommitment(e.target.value)}
                  rows={2}
                  className="text-sm"
                />

                <div className="flex items-center gap-3">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">Follow-up date</label>
                  <input
                    type="date"
                    value={followUpDate}
                    min={new Date().toISOString().split("T")[0]}
                    onChange={e => setFollowUpDate(e.target.value)}
                    className="rounded-md border border-border px-3 py-1.5 text-sm bg-background"
                  />
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-2">Outcome of the call</p>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => handleOutcome("Resolved")} disabled={outcomeLoading}
                      className="flex-1 border-success/40 text-success hover:bg-success/10">
                      ✓ Mark Resolved
                    </Button>
                    <Button variant="outline" onClick={() => handleOutcome("Escalated")} disabled={outcomeLoading}
                      className="flex-1">
                      ↑ Escalate
                    </Button>
                    <Button variant="outline" onClick={() => handleOutcome("Churned")} disabled={outcomeLoading}
                      className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10">
                      ✗ Log as Churned
                    </Button>
                  </div>
                  {outcomeError && <p className="mt-2 text-xs text-destructive text-center">{outcomeError}</p>}
                  <p className="mt-2 text-xs text-muted-foreground text-center">Each outcome = one labeled training example for the XGBoost model</p>
                </div>
              </div>
                )}
              </div>
            )}
          </TabsContent>

        </Tabs>
      </main>
    </div>
  );
}

// ─── buildReasons ─────────────────────────────────────────────────────────────

function buildReasons(s: Seller): string[] {
  const out: string[] = [];
  const m = s.metrics;
  const drop = (h: MetricHistory[]) => h.length >= 2 ? h[0].value - h[h.length - 1].value : 0;
  const last = (h: MetricHistory[]) => h.length > 0 ? h[h.length - 1].value : 0;

  if (s.priorChurn) out.push("Previously on Free/lapsed plan — prior churn is the #1 predictor of repeat churn (risk elevated 30%).");
  if (drop(m.loginPct) > 8)          out.push(`Login activity dropped ${drop(m.loginPct).toFixed(0)}% over 3 months (now ${last(m.loginPct).toFixed(0)}%).`);
  if (drop(m.blConsumptionPct) > 8)  out.push(`Buy-Lead consumption fell ${drop(m.blConsumptionPct).toFixed(0)}% — seller not extracting value.`);
  if (drop(m.pnsPickupRatePct) > 6)  out.push(`PNS pickup rate down to ${last(m.pnsPickupRatePct).toFixed(0)}% — missing buyer calls.`);
  if (drop(m.lmsReplyRatePct) > 6)   out.push(`LMS reply rate down to ${last(m.lmsReplyRatePct).toFixed(0)}% — slow buyer response.`);
  if (last(m.retailBlRecommendedPct) > 50) out.push(`${last(m.retailBlRecommendedPct).toFixed(0)}% of recommended BLs are retail — poor lead-fit for a B2B seller.`);
  if (last(m.catalogScore) < 60)     out.push(`Catalog score is ${last(m.catalogScore).toFixed(0)} — listings need refresh.`);
  if (last(m.cqs) < 55)              out.push(`Content Quality Score ${last(m.cqs).toFixed(0)} — product descriptions and images below threshold.`);

  const comp = (s.callInsights ?? []).find(c => c.competitorMentioned)?.competitorMentioned;
  if (comp) out.push(`Competitor "${comp}" mentioned on call — actively evaluating alternatives.`);

  if (out.length === 0) out.push("Metrics stable. Flagged on composite renewal-window risk.");
  return out;
}

// ─── Rule-based guide ─────────────────────────────────────────────────────────

type GuideEntry = { title: string; pitch: string; actions: string[] };

function buildGuide(s: Seller): GuideEntry[] {
  const m = s.metrics;
  const drop = (h: MetricHistory[]) => h.length >= 2 ? h[0].value - h[h.length - 1].value : 0;
  const last = (h: MetricHistory[]) => h.length > 0 ? h[h.length - 1].value : 0;
  const out: GuideEntry[] = [];

  if (s.priorChurn) out.push({
    title: "Address re-engagement from scratch",
    pitch: `${s.name} churned previously and re-acquired. The biggest risk is they never properly onboarded after returning. Open by acknowledging their prior experience — don't treat this like a first renewal.`,
    actions: [
      "Ask directly: what made them leave last time, and has that changed?",
      "Walk through 2–3 recent buyer enquiries they may have missed",
      "Offer a dedicated onboarding session with product team",
    ],
  });

  if (drop(m.loginPct) > 8) out.push({
    title: "Re-engage on platform usage",
    pitch: `Login activity has slipped to ${last(m.loginPct).toFixed(0)}%. Frame inactivity as lost revenue — show ${s.name} the unread buyer messages and hot leads they've been missing.`,
    actions: [
      "Walk through 2–3 hot buyer leads they haven't opened",
      "Enable mobile push and weekly digest emails",
      "Schedule a 15-min product re-onboarding call",
    ],
  });

  if (drop(m.blConsumptionPct) > 8) out.push({
    title: "Recover Buy-Lead value",
    pitch: `Buy-Lead consumption fell ${drop(m.blConsumptionPct).toFixed(0)}% — they're paying for credits they aren't using. Position renewal as 'pay only for value delivered'.`,
    actions: [
      "Audit and reset BL filters (category, geography, price range)",
      "Show ROI: BLs purchased vs. orders won in last 90 days",
      "Offer to top-up unused credits into next cycle",
    ],
  });

  if (drop(m.pnsPickupRatePct) > 6) out.push({
    title: "Fix missed buyer calls (PNS)",
    pitch: `Pickup rate is ${last(m.pnsPickupRatePct).toFixed(0)}%. Every missed call is a lost order — tie this directly to revenue they could have closed.`,
    actions: [
      "Add a backup number / staff member to PNS routing",
      "Enable IVR + WhatsApp fallback for missed calls",
      "Share the count of missed enquiries last month",
    ],
  });

  if (drop(m.lmsReplyRatePct) > 6) out.push({
    title: "Speed up lead replies (LMS)",
    pitch: `LMS reply rate is ${last(m.lmsReplyRatePct).toFixed(0)}%. Buyers contact 3–4 sellers — slow replies kill conversion.`,
    actions: [
      "Set up quick-reply templates for top 5 enquiry types",
      "Assign LMS to a dedicated team member",
      "Enable SLA alerts for unanswered leads >2 hrs",
    ],
  });

  if (last(m.retailBlRecommendedPct) > 50) out.push({
    title: "Fix lead-fit quality",
    pitch: `${last(m.retailBlRecommendedPct).toFixed(0)}% of recommended BLs are retail — wrong fit for a B2B seller. This is a platform issue, not seller failure.`,
    actions: [
      "Re-tag product catalog as B2B/wholesale only",
      "Update minimum order quantity on listings",
      "Escalate BL filter misconfiguration to Product team",
    ],
  });

  const comp = (s.callInsights ?? []).find(c => c.competitorMentioned)?.competitorMentioned;
  if (comp) out.push({
    title: `Counter ${comp} comparison`,
    pitch: `${s.name} mentioned ${comp} on a recent call. Address this directly — don't ignore it. Lead with IndiaMART's 10 crore active buyers vs. competitor reach.`,
    actions: [
      `Pull up competitor comparison: IndiaMART buyer base vs. ${comp}`,
      "Show category-specific lead volume data for this seller's segment",
      "If pricing is the issue, escalate loyalty discount request to Sales Manager",
    ],
  });

  if (out.length === 0) out.push({
    title: "Reinforce the relationship",
    pitch: `${s.name} is performing well. Use this renewal as a chance to upsell — they're a candidate for the next package tier.`,
    actions: [
      "Share a success summary: leads won, orders, ROI",
      "Pitch upgrade to next package with added BL credits",
      "Request a testimonial / case study",
    ],
  });

  return out;
}

function RetentionGuide({ seller }: { seller: Seller }) {
  const sections = buildGuide(seller);
  return (
    <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <p className="font-medium">Opening line</p>
        <p className="mt-1 text-muted-foreground">
          "Hi {seller.name.split(" ")[0]}, your renewal is in {seller.daysToRenewal} days. Before we discuss it, I want to walk you through what we've seen on your account in the last 90 days and how we can fix it together."
        </p>
      </div>
      <GuideSectionList sections={sections} />
    </div>
  );
}

function GuideSectionList({ sections }: { sections: GuideEntry[] }) {
  return (
    <>
      {sections.map((sec, i) => (
        <div key={i} className="rounded-xl border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-primary/20 animate-slide-in-up" style={{ animationDelay: `${i * 60}ms` }}>
          <p className="text-sm font-semibold">{i + 1}. {sec.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{sec.pitch}</p>
          <ul className="mt-2 space-y-1">
            {sec.actions.map((a, j) => (
              <li key={j} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

function MetricCard({ label, data, invert, isCount }: { label: string; data: MetricHistory[]; invert?: boolean; isCount?: boolean }) {
  if (data.length === 0) {
    return (
      <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-sm text-muted-foreground">No data</p>
        </CardContent>
      </Card>
    );
  }

  const first = data[0].value;
  const last = data[data.length - 1].value;
  const delta = last - first;
  const isBad = invert ? delta > 0 : delta < 0;
  const TrendIcon = delta >= 0 ? TrendingUp : TrendingDown;
  const suffix = isCount ? "" : label.includes("Score") ? "" : "%";
  const yDomain: [number | "auto", number | "auto"] = isCount ? [0, "auto"] : [0, 100];

  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">{last.toFixed(0)}{suffix}</p>
          </div>
          <div className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${isBad ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"}`}>
            <TrendIcon className="h-3 w-3" />
            {delta > 0 ? "+" : ""}{delta.toFixed(0)}
          </div>
        </div>
        <div className="mt-4 h-24">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} domain={yDomain} />
              <Tooltip contentStyle={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="value" stroke={isBad ? "var(--destructive)" : "var(--success)"} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── CallInsightsList ─────────────────────────────────────────────────────────

const sentimentStyle: Record<CallInsight["sentiment"], string> = {
  Negative: "bg-destructive/15 text-destructive border-destructive/30",
  Neutral:  "bg-muted text-muted-foreground border-border",
  Positive: "bg-success/15 text-success border-success/30",
};

const dispositionStyle: Record<string, string> = {
  Willing:   "text-success",
  Skeptical: "text-warning",
  Hostile:   "text-destructive",
};

function CallInsightsList({ insights }: { insights: CallInsight[] }) {
  if (insights.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No call insights recorded for this seller yet.
        </CardContent>
      </Card>
    );
  }

  const allIssues = Array.from(new Set(insights.flatMap(c => c.issues).filter(Boolean)));

  return (
    <div className="space-y-4">
      {allIssues.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6">
            <p className="text-sm font-semibold">Recurring concerns from calls</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {allIssues.map(iss => (
                <span key={iss} className="rounded-md border border-destructive/30 bg-background px-2 py-1 text-xs font-medium text-destructive">{iss}</span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {insights.map((c) => (
          <Card key={c.id} className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{fmtDate(c.date)}</span>
                  <span className="text-muted-foreground">· {c.durationMin}m · {c.agent}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${sentimentStyle[c.sentiment]}`}>{c.sentiment}</span>
                </div>
              </div>
              <p className="mt-3 text-sm">{c.summary}</p>
              {c.disposition && (
                <p className="mt-1 text-xs">
                  Disposition: <span className={`font-medium ${dispositionStyle[c.disposition] ?? ""}`}>{c.disposition}</span>
                  {c.competitorMentioned && <span className="ml-2 text-destructive font-medium">⚠ {c.competitorMentioned}</span>}
                </p>
              )}
              {c.quote && (
                <div className="mt-3 flex gap-2 rounded-md border-l-2 border-destructive bg-muted/40 p-2 text-sm italic text-muted-foreground">
                  <Quote className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  <span>"{c.quote}"</span>
                </div>
              )}
              {c.commitmentByExec && (
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium">Exec committed:</span> {c.commitmentByExec}
                </p>
              )}
              {c.issues.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.issues.map(iss => (
                    <span key={iss} className="rounded border bg-background px-1.5 py-0.5 text-xs text-foreground">{iss}</span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── LeadsChart ───────────────────────────────────────────────────────────────

function LeadsChart({ data }: { data: LeadsMonthData[] }) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          Lead volume data not available — requires IndiaMART warehouse integration.
        </CardContent>
      </Card>
    );
  }

  const latest = data[data.length - 1];
  const totalConsumed = data.reduce((s, d) => s + d.blConsumed, 0);
  const totalEnq = data.reduce((s, d) => s + d.totalEnq, 0);
  const totalLapsed = data.reduce((s, d) => s + d.blLapsed, 0);
  const fastPct = latest.blConsumed > 0
    ? Math.round((latest.cons0to4hrs / latest.blConsumed) * 100)
    : 0;

  const tooltipStyle = { background: "var(--background)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {[
          { label: "BL Consumed (6m)", value: totalConsumed },
          { label: "Total Enquiries (6m)", value: totalEnq },
          { label: "BL Lapsed (6m)", value: totalLapsed, warn: totalLapsed > totalConsumed },
          { label: "Consumed <4 hrs (latest)", value: `${fastPct}%`, good: fastPct >= 40 },
        ].map(({ label, value, warn, good }) => (
          <Card key={label} className={`transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${warn ? "border-destructive/30 bg-destructive/5" : good ? "border-success/30 bg-success/5" : ""}`}>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`mt-1 text-2xl font-semibold tracking-tight ${warn ? "text-destructive" : good ? "text-success" : ""}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Monthly volume chart */}
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm font-medium mb-4">Monthly lead volume</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }} barGap={2} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="totalEnq" name="Enquiries" fill="var(--primary)" radius={[3, 3, 0, 0]} opacity={0.8} />
                <Bar dataKey="blConsumed" name="BL Consumed" fill="var(--success)" radius={[3, 3, 0, 0]} opacity={0.8} />
                <Bar dataKey="blLapsed" name="BL Lapsed" fill="var(--destructive)" radius={[3, 3, 0, 0]} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Consumption timing chart */}
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm font-medium mb-1">Lead consumption timing</p>
          <p className="text-xs text-muted-foreground mb-4">How quickly this seller acts on new buy leads — faster is better.</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="cons0to4hrs" name="0–4 hrs" stackId="a" fill="var(--success)" opacity={0.9} />
                <Bar dataKey="cons4to24hrs" name="4–24 hrs" stackId="a" fill="var(--warning)" opacity={0.85} />
                <Bar dataKey="consGt1day" name=">1 day" stackId="a" fill="var(--destructive)" opacity={0.75} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
