import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import {
  riskBand, metricLabels, statusMeta, countMetrics,
  churnCauseMeta, archetypeMeta,
  type Seller, type MetricHistory, type CallInsight, type ChurnCause,
  type LeadsMonthData,
} from "@/lib/mock-sellers";
import {
  fetchSeller, logOutcome, fetchRetentionGuide, fetchMLPrediction, fetchMLStats,
  triggerRetraining, uploadAudio, extractMerpNote,
  type GuideSection, type MLPrediction, type MLStats,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, AlertTriangle, TrendingDown, TrendingUp, Phone, Quote,
  Zap, Brain, CheckCircle2, Upload, FileText,
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend } from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
        <Link to="/" search={{ view: "churn" }} className="mt-4 inline-block text-primary underline">Back to dashboard</Link>
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

  // AI guide state
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideSections, setGuideSections] = useState<GuideSection[] | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);

  // ML state
  const [mlPred, setMlPred] = useState<MLPrediction | null>(null);
  const [mlStats, setMlStats] = useState<MLStats | null>(null);
  const [mlLoading, setMlLoading] = useState(false);
  const [retrainResult, setRetrainResult] = useState<string | null>(null);

  // MERP note state
  const [merpNote, setMerpNote] = useState("");
  const [merpAgent, setMerpAgent] = useState("");
  const [merpLoading, setMerpLoading] = useState(false);
  const [merpError, setMerpError] = useState<string | null>(null);

  // Audio upload state
  const [audioError, setAudioError] = useState<string | null>(null);

  // ── All hooks must be declared before any early return ──────────────────────

  const handleOutcome = useCallback(async (outcome: string) => {
    if (!seller || outcomeLoading) return;
    setOutcomeLoading(true);
    setOutcomeError(null);
    try {
      const result = await logOutcome(seller.id, outcome);
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
  }, [seller, outcomeLoading]);

  const handleGenerateGuide = useCallback(async () => {
    if (!seller) return;
    setGuideLoading(true);
    setGuideError(null);
    try {
      const result = await fetchRetentionGuide(seller.id);
      setGuideSections(result.sections);
    } catch {
      setGuideError("Could not connect to AI service. Make sure the Go backend is running.");
    } finally {
      setGuideLoading(false);
    }
  }, [seller]);

  const handleLoadML = useCallback(async () => {
    if (!seller || mlLoading) return;
    setMlLoading(true);
    try {
      const [pred, stats] = await Promise.all([
        fetchMLPrediction(seller.id),
        fetchMLStats(),
      ]);
      setMlPred(pred);
      setMlStats(stats);
    } catch {
      setMlPred(null);
    } finally {
      setMlLoading(false);
    }
  }, [seller, mlLoading]);

  const handleRetrain = useCallback(async () => {
    try {
      const result = await triggerRetraining();
      setRetrainResult(`Retrained on ${result.trainingExamples} examples. AUC: ${result.auc.toFixed(3)} (was ${result.previousAuc.toFixed(3)}). ${result.swapped ? "New model deployed." : "No improvement — current model kept."}`);
      await handleLoadML();
    } catch {
      setRetrainResult("Retrain failed — ML service may not be running.");
    }
  }, [handleLoadML]);

  const handleMerpExtract = useCallback(async () => {
    if (!seller || !merpNote.trim() || merpLoading) return;
    setMerpLoading(true);
    setMerpError(null);
    try {
      const insight = await extractMerpNote(merpNote, seller.id, merpAgent || "Unknown Agent");
      setSeller(s => s ? { ...s, callInsights: [insight, ...(s.callInsights ?? [])] } : s);
      setMerpNote("");
      setMerpAgent("");
    } catch {
      setMerpError("Could not extract MERP note — check that the Go backend is running.");
    } finally {
      setMerpLoading(false);
    }
  }, [seller, merpNote, merpAgent, merpLoading]);

  const handleAudioUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !seller) return;
    setAudioError(null);
    try {
      const insight = await uploadAudio(file, seller.id, "Demo Agent");
      setSeller(s => s ? { ...s, callInsights: [insight, ...(s.callInsights ?? [])] } : s);
    } catch {
      setAudioError("Audio upload failed — check that the Go backend is running.");
    }
    e.target.value = "";
  }, [seller]);

  // ── Early return after all hooks ────────────────────────────────────────────

  if (!seller) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Seller not found.</p>
          <Button onClick={() => router.navigate({ to: "/", search: { view: "churn" } })} className="mt-4">Back to dashboard</Button>
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
      <header className="border-b bg-background/80 backdrop-blur-md sticky top-0 z-20">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <Link to="/" search={{ view: "churn" }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-all duration-150 hover:text-foreground hover:-translate-x-0.5">
            <ArrowLeft className="h-4 w-4" /> Back to cohort
          </Link>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary/25 to-primary/5 text-lg font-semibold text-primary ring-2 ring-primary/10 shadow-lg">
                {seller.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                {seller.priorChurn && (
                  <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive border-2 border-background flex items-center justify-center text-[8px] text-white font-bold" title="Prior churn">!</span>
                )}
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{seller.name}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{seller.company} · {seller.city}</span>
                  <Badge variant="outline">{seller.packageType}</Badge>
                  <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${statusMeta[seller.status as keyof typeof statusMeta]?.className ?? ""}`}>
                    {seller.status}
                  </span>
                  <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${causeMeta.className}`} title={causeMeta.description}>
                    {causeMeta.label}
                  </span>
                  <span className="text-xs" title={archMeta.description}>{archMeta.emoji} {seller.archetype}</span>
                  {(() => {
                    const days = seller.metrics.blActiveDays ?? [];
                    const v = days.length > 0 ? days[days.length - 1].value : null;
                    return v !== null ? (
                      <span className="text-xs text-muted-foreground border rounded px-1.5 py-0.5" title="BL active days this month">
                        {v}d active
                      </span>
                    ) : null;
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        {/* Prior churn warning */}
        {seller.priorChurn && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="pt-4 pb-4 flex items-start gap-3 text-sm">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-destructive">Prior churn detected</p>
                <p className="text-muted-foreground mt-0.5">
                  This seller was previously on a Free/lapsed plan before re-acquiring. Prior churn is the strongest single predictor of repeat churn — risk score is elevated by 30%. Treat as critical regardless of current signal levels.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary cards */}
        <div className="grid gap-4 md:grid-cols-5">
          <Card className={`transition-all duration-200 hover:-translate-y-1 hover:shadow-lg cursor-default select-none ${band === "High" ? "border-destructive/40 bg-destructive/5" : band === "Medium" ? "border-warning/40 bg-warning/5" : "border-success/40 bg-success/5"}`}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><AlertTriangle className="h-4 w-4" /> Risk score</div>
              <p className="mt-2 text-4xl font-semibold tracking-tight">{seller.riskScore}<span className="text-lg text-muted-foreground">/100</span></p>
              <p className="mt-1 text-sm font-medium">{band} risk of churn</p>
            </CardContent>
          </Card>
          <Card className="transition-all duration-200 hover:-translate-y-1 hover:shadow-lg cursor-default select-none">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Renewal date</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{fmtDate(seller.renewalDate)}</p>
              <p className="mt-1 text-sm text-muted-foreground">in {seller.daysToRenewal} days</p>
            </CardContent>
          </Card>
          <Card className="transition-all duration-200 hover:-translate-y-1 hover:shadow-lg cursor-default select-none">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Annual revenue</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">₹{(seller.arr / 1000).toFixed(0)}k</p>
              <p className="mt-1 text-sm text-muted-foreground">{seller.category}</p>
            </CardContent>
          </Card>
          <Card className="transition-all duration-200 hover:-translate-y-1 hover:shadow-lg cursor-default select-none">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Churn cause</p>
              <p className="mt-2 text-xl font-semibold tracking-tight">{causeMeta.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">→ {causeMeta.owner}</p>
            </CardContent>
          </Card>
          <Card className="transition-all duration-200 hover:-translate-y-1 hover:shadow-lg cursor-default select-none">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Seller ID</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{seller.id}</p>
              <p className="mt-1 text-xs text-muted-foreground">{(seller.churnCauseReason ?? "").slice(0, 55)}{seller.churnCauseReason?.length > 55 ? "…" : ""}</p>
            </CardContent>
          </Card>
        </div>

        {/* Why flagged */}
        <Card className="transition-all duration-200 hover:shadow-md">
          <CardHeader><CardTitle className="text-base">Why this seller is flagged</CardTitle></CardHeader>
          <CardContent>
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

        {/* Tabs */}
        <Tabs defaultValue="behavior">
          <TabsList className="h-auto flex-wrap gap-2 bg-transparent p-0">
            {[
              ["behavior", "Past behaviour"],
              ["leads", "IndiaMART Leads"],
              ["calls", "Call insights"],
              ["guide", "Retention guide"],
              ["ml", "ML insights"],
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

          {/* ── Call insights ── */}
          <TabsContent value="calls" className="mt-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Sales call insights</h2>
                <p className="text-sm text-muted-foreground">Issues raised by seller in calls — surfaced as churn drivers.</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <label className="cursor-pointer">
                  <input type="file" accept="audio/*" className="hidden" onChange={handleAudioUpload} />
                  <span className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted cursor-pointer">
                    <Upload className="h-4 w-4" /> Process audio
                  </span>
                </label>
                {audioError && <p className="text-xs text-destructive">{audioError}</p>}
              </div>
            </div>

            {/* MERP note input */}
            <Card className="mb-4">
              <CardContent className="pt-4 pb-4 space-y-3">
                <p className="text-sm font-semibold flex items-center gap-2"><FileText className="h-4 w-4" /> Extract from MERP note</p>
                <Textarea
                  placeholder="Paste raw MERP CRM note here... e.g. 'Called Vikram. Maxi | Talked | Said TradeIndia offering 30% less...'"
                  value={merpNote}
                  onChange={e => setMerpNote(e.target.value)}
                  rows={3}
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <input
                    placeholder="Agent name"
                    value={merpAgent}
                    onChange={e => setMerpAgent(e.target.value)}
                    className="flex-1 rounded-md border px-3 py-2 text-sm bg-background"
                  />
                  <Button onClick={handleMerpExtract} disabled={!merpNote.trim() || merpLoading} size="sm">
                    {merpLoading ? "Extracting..." : "Extract with AI"}
                  </Button>
                </div>
                {merpError && <p className="text-xs text-destructive">{merpError}</p>}
              </CardContent>
            </Card>

            <CallInsightsList insights={seller.callInsights ?? []} />
          </TabsContent>

          {/* ── Retention guide ── */}
          <TabsContent value="guide" className="mt-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">How to retain {seller.name}</h2>
                <p className="text-sm text-muted-foreground">Talking points and actions tailored to this seller's data.</p>
              </div>
              <Button onClick={handleGenerateGuide} disabled={guideLoading} className="gap-2">
                <Zap className="h-4 w-4" />
                {guideLoading ? "Generating…" : guideSections ? "Regenerate AI guide" : "Generate AI guide"}
              </Button>
            </div>

            {guideError && (
              <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {guideError}
              </div>
            )}

            {guideSections ? (
              <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                <div className="rounded-md border bg-primary/5 border-primary/20 p-3 text-sm flex items-start gap-2">
                  <Brain className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <p className="text-muted-foreground"><span className="font-medium text-foreground">AI-generated guide</span> — personalized using this seller's exact metrics and call history.</p>
                </div>
                <GuideSectionList sections={guideSections} />
              </div>
            ) : (
              <RetentionGuide seller={seller} />
            )}

            {/* Outcome logging */}
            {outcomeSaved ? (
              <div className="mt-6 rounded-md border border-success/40 bg-success/5 px-4 py-3 text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                <span>
                  <span className="font-medium">Outcome logged: {outcomeSaved}.</span>
                  {totalOutcomes !== null && ` ${totalOutcomes} training examples collected.`}
                </span>
              </div>
            ) : (
              <div className="mt-6 border-t pt-4">
                <p className="text-xs text-muted-foreground mb-3">After the retention call, log the outcome to train the ML model:</p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => handleOutcome("Resolved")} disabled={outcomeLoading}
                    className="flex-1 border-success/40 text-success hover:bg-success/10">
                    ✓ Mark Resolved
                  </Button>
                  <Button variant="outline" onClick={() => handleOutcome("Escalated")} disabled={outcomeLoading} className="flex-1">
                    ↑ Escalate
                  </Button>
                  <Button variant="outline" onClick={() => handleOutcome("Churned")} disabled={outcomeLoading}
                    className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10">
                    ✗ Log as Churned
                  </Button>
                </div>
                {outcomeError && (
                  <p className="mt-2 text-xs text-destructive text-center">{outcomeError}</p>
                )}
                <p className="mt-2 text-xs text-muted-foreground text-center">Each outcome saved = one labeled training example for the XGBoost model</p>
              </div>
            )}
          </TabsContent>

          {/* ── ML Insights ── */}
          <TabsContent value="ml" className="mt-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">ML Insights</h2>
                <p className="text-sm text-muted-foreground">XGBoost model prediction alongside rule-based score.</p>
              </div>
              <Button onClick={handleLoadML} disabled={mlLoading} variant="outline" className="gap-2">
                <Brain className="h-4 w-4" />
                {mlLoading ? "Loading…" : mlPred ? "Refresh" : "Load ML prediction"}
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Rule vs ML scores */}
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground mb-4">Score comparison</p>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Rule engine</span>
                        <span className="font-semibold">{seller.riskScore}/100</span>
                      </div>
                      <div className="h-3 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-destructive rounded-full" style={{ width: `${seller.riskScore}%` }} />
                      </div>
                    </div>
                    {mlPred ? (
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span>XGBoost model</span>
                          <span className="font-semibold">{(mlPred.churnProb * 100).toFixed(0)}% churn prob</span>
                        </div>
                        <div className="h-3 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${mlPred.churnProb * 100}%` }} />
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground text-center">
                        Click "Load ML prediction" to see XGBoost score
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Feature importances */}
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground mb-4">Top signals driving ML prediction</p>
                  {mlPred?.topFeatures ? (
                    <div className="space-y-2">
                      {mlPred.topFeatures.map((f, i) => (
                        <div key={f} className="flex items-center gap-3 text-sm">
                          <span className="text-muted-foreground w-4">{i + 1}.</span>
                          <span className="flex-1 font-mono text-xs bg-muted px-2 py-1 rounded">{f}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground text-center">
                      Load prediction to see feature importances
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Model stats */}
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground mb-4">Model statistics</p>
                  {mlStats ? (
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Training examples</span>
                        <span className="font-semibold">{mlStats.trainingExamples.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">AUC (holdout)</span>
                        <span className="font-semibold">{mlStats.auc.toFixed(3)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Auto-retrain at</span>
                        <span className="font-semibold">{mlStats.nextRetrainAt?.toLocaleString()} outcomes</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last trained</span>
                        <span className="font-semibold text-xs">{mlStats.lastTrainedAt ? new Date(mlStats.lastTrainedAt).toLocaleString() : "—"}</span>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>Progress to auto-retrain</span>
                          <span>{Math.round((mlStats.trainingExamples / (mlStats.nextRetrainAt ?? 5000)) * 100)}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${Math.min(100, (mlStats.trainingExamples / (mlStats.nextRetrainAt ?? 5000)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground text-center">
                      Load prediction to see model stats
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Retrain */}
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground mb-2">Manual retrain</p>
                  <p className="text-xs text-muted-foreground mb-4">
                    Retrains XGBoost on all labeled outcomes. System auto-retrains at 5,000 real examples — this triggers it early for demo purposes.
                  </p>
                  <Button onClick={handleRetrain} variant="outline" className="w-full gap-2">
                    <Brain className="h-4 w-4" /> Trigger Retraining Now
                  </Button>
                  {retrainResult && (
                    <p className="mt-3 text-xs text-muted-foreground">{retrainResult}</p>
                  )}
                </CardContent>
              </Card>
            </div>
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

function GuideSectionList({ sections }: { sections: GuideEntry[] | GuideSection[] }) {
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
          No call insights yet. Process an audio file or paste a MERP note above.
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
                  {c.source && <span className="text-xs text-muted-foreground border rounded px-1.5 py-0.5">{c.source}</span>}
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
