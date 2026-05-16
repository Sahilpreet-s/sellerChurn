import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useCallback, useRef } from "react";
import { fetchSeller, agentStream, type AgentStepEvent } from "@/lib/api";
import { riskBand, churnCauseMeta, type Seller } from "@/lib/mock-sellers";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Zap, ArrowLeft, CheckCircle2, Loader2, AlertCircle,
  Brain, BarChart2, BookOpen, Search,
} from "lucide-react";

export const Route = createFileRoute("/demo")({
  component: DemoPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type LogStatus = "running" | "done" | "error";
type LogLine   = { id: number; status: LogStatus; text: string };

type AgentGuideSection = { title: string; pitch: string; actions: string[] };
type AgentOutput = {
  churnProb:   number;
  topFeatures: string[];
  riskScore:   number;
  churnCause:  string;
  causeReason: string;
  guide:       AgentGuideSection[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _id = 0;
const nextId = () => ++_id;

function riskColor(score: number) {
  const b = riskBand(score);
  if (b === "High")   return "text-destructive";
  if (b === "Medium") return "text-warning";
  return "text-success";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function DemoPage() {
  const [input,       setInput]       = useState("");
  const [running,     setRunning]     = useState(false);
  const [log,         setLog]         = useState<LogLine[]>([]);
  const [seller,      setSeller]      = useState<Seller | null>(null);
  const [agentOut,    setAgentOut]    = useState<AgentOutput | null>(null);
  const [globalError, setGlobalError] = useState("");
  const stopRef = useRef<(() => void) | null>(null);

  // Append / update log lines
  const addLog = useCallback((text: string, status: LogStatus = "running"): number => {
    const id = nextId();
    setLog(prev => [...prev, { id, status, text }]);
    return id;
  }, []);

  const resolveLog = useCallback((id: number, text: string, status: LogStatus = "done") => {
    setLog(prev => prev.map(l => l.id === id ? { ...l, text, status } : l));
  }, []);

  const analyze = useCallback(async () => {
    const sellerId = input.trim();
    if (!sellerId) return;

    // Reset
    stopRef.current?.();
    setRunning(true);
    setLog([]);
    setSeller(null);
    setAgentOut(null);
    setGlobalError("");

    // ── Step 1: fetch seller profile ──────────────────────────────────────
    const fetchId = addLog("Fetching seller profile...");
    let sellerData: Seller;
    try {
      sellerData = await fetchSeller(sellerId);
      setSeller(sellerData);
      resolveLog(fetchId, `Seller found: ${sellerData.name} · ${sellerData.category} · ${sellerData.packageType}`);
    } catch {
      resolveLog(fetchId, `Seller "${sellerId}" not found — check the GLID`, "error");
      setRunning(false);
      return;
    }

    // ── Step 2: run the LangGraph agent ───────────────────────────────────
    const pipeId = addLog("Starting LangGraph agent pipeline...");
    resolveLog(pipeId, "LangGraph pipeline started — 3 nodes queued");

    const partial: Partial<AgentOutput> = {};

    const stop = agentStream(
      sellerId,

      (ev: AgentStepEvent) => {
        if (ev.step === "xgboost") {
          partial.churnProb   = ev.churnProb;
          partial.topFeatures = ev.topFeatures;
          addLog("Risk scored — passing signals to LLM classifier", "done");
        }

        if (ev.step === "classify") {
          partial.churnCause  = ev.churnCause;
          partial.causeReason = ev.causeReason;
          partial.riskScore   = ev.riskScore;
          addLog(`Cause classified: ${ev.churnCause} — ${ev.causeReason}`, "done");
        }

        if (ev.step === "guide") {
          partial.guide = ev.guide;
          addLog(`Retention guide ready — ${ev.guide.length} sections`, "done");
        }
      },

      (err: string) => {
        addLog(`Agent error: ${err}`, "error");
        setRunning(false);
      },

      () => {
        addLog("Analysis complete", "done");
        setAgentOut({
          churnProb:   partial.churnProb   ?? 0,
          topFeatures: partial.topFeatures ?? [],
          riskScore:   partial.riskScore   ?? 0,
          churnCause:  partial.churnCause  ?? "Mixed",
          causeReason: partial.causeReason ?? "",
          guide:       partial.guide       ?? [],
        });
        setRunning(false);
      },
    );

    stopRef.current = stop;
  }, [input, addLog, resolveLog]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") analyze();
  };

  const causeMeta = agentOut ? churnCauseMeta[agentOut.churnCause as keyof typeof churnCauseMeta] : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/20 to-muted/40">

      {/* ── Header ── */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-20">
        <div className="flex items-center gap-3 px-6 py-4">
          <Link to="/" search={{ view: "churn" }} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="h-4 w-px bg-border" />
          <Badge className="bg-primary/10 text-primary border-primary/20 gap-1.5 font-semibold">
            <Zap className="h-3 w-3" /> LIVE DEMO
          </Badge>
          <span className="text-sm font-medium text-foreground">Agent in Action</span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">

        {/* ── Hero ── */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">
            Watch the agent analyse a seller in real time
          </h1>
          <p className="text-sm text-muted-foreground">
            LangGraph orchestrates XGBoost scoring → LLM cause classification → retention guide generation
          </p>
        </div>

        {/* ── Input ── */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Enter seller GLID — e.g. S-20001"
              disabled={running}
              className="w-full rounded-lg border border-input bg-background pl-9 pr-4 py-2.5 text-sm
                         placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40
                         disabled:opacity-50 transition-all"
            />
          </div>
          <Button onClick={analyze} disabled={running || !input.trim()} className="gap-2 px-5">
            {running
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Analysing…</>
              : <><Zap className="h-4 w-4" /> Analyse Seller</>}
          </Button>
        </div>

        {/* ── Terminal log ── */}
        {log.length > 0 && (
          <div className="rounded-xl border border-border/60 bg-zinc-950 overflow-hidden">
            <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-zinc-800">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
              <span className="ml-2 text-xs text-zinc-500 font-mono">sellerpulse · agent pipeline</span>
              {running && <Loader2 className="ml-auto h-3 w-3 animate-spin text-zinc-500" />}
            </div>
            <div className="p-4 space-y-1.5 font-mono text-sm">
              {log.map((line, i) => (
                <div
                  key={line.id}
                  className="flex items-start gap-2.5 animate-slide-in-up"
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  {line.status === "running" && (
                    <Loader2 className="h-3.5 w-3.5 mt-0.5 shrink-0 animate-spin text-zinc-500" />
                  )}
                  {line.status === "done" && (
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-400" />
                  )}
                  {line.status === "error" && (
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-400" />
                  )}
                  <span className={
                    line.status === "done"  ? "text-zinc-200" :
                    line.status === "error" ? "text-red-400"  : "text-zinc-500"
                  }>
                    {line.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Results ── */}
        {agentOut && seller && (
          <div className="space-y-5 animate-slide-in-up">

            {/* Stat cards */}
            <div className="grid gap-3 grid-cols-2">
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
                    <BarChart2 className="h-3.5 w-3.5" /> LLM Risk Score
                  </p>
                  <p className={`text-2xl font-bold ${riskColor(agentOut.riskScore)}`}>
                    {agentOut.riskScore}
                  </p>
                  <p className="text-xs text-muted-foreground">{riskBand(agentOut.riskScore)} risk</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
                    <Brain className="h-3.5 w-3.5" /> LLM Risk Assessment
                  </p>
                  {causeMeta ? (
                    <>
                      <p className="text-sm font-bold">{causeMeta.label}</p>
                      <p className="text-xs text-muted-foreground">{causeMeta.owner}</p>
                    </>
                  ) : (
                    <p className="text-sm font-bold">{agentOut.churnCause}</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Seller strip — company and daysToRenewal hidden when not available */}
            <div className="rounded-lg border bg-card px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-semibold">{seller.name}</span>
              {seller.company && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{seller.company}</span>
                </>
              )}
              {seller.category && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{seller.category}</span>
                </>
              )}
              <span className="text-muted-foreground">·</span>
              <Badge variant="outline" className="text-xs">{seller.packageType}</Badge>
              {seller.daysToRenewal > 0 && (
                <span className="text-muted-foreground ml-auto text-xs">
                  {seller.daysToRenewal} days to renewal
                </span>
              )}
            </div>

            {/* Cause reason */}
            {agentOut.causeReason && (
              <div className="rounded-lg border-l-4 border-l-primary bg-primary/5 px-4 py-3 text-sm">
                <p className="font-medium text-xs text-primary mb-0.5">Agent reasoning</p>
                <p className="text-muted-foreground">{agentOut.causeReason}</p>
              </div>
            )}


            {/* Retention guide */}
            {agentOut.guide.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-semibold flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  Retention Guide
                </p>
                {agentOut.guide.map((sec, i) => (
                  <div
                    key={i}
                    className="rounded-xl border p-4 space-y-2 animate-slide-in-up hover:-translate-y-0.5 hover:shadow-md transition-all duration-200"
                    style={{ animationDelay: `${i * 80}ms` }}
                  >
                    <p className="text-sm font-semibold">{i + 1}. {sec.title}</p>
                    <p className="text-sm text-muted-foreground">{sec.pitch}</p>
                    {sec.actions?.length > 0 && (
                      <ul className="space-y-1 pt-1">
                        {sec.actions.map((a, j) => (
                          <li key={j} className="flex items-start gap-2 text-sm">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                            <span>{a}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            {globalError && (
              <p className="text-sm text-destructive">{globalError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
