import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { getSeller, riskBand, metricLabels, statusMeta, type Seller, type MetricHistory, type CallInsight } from "@/lib/mock-sellers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertTriangle, TrendingDown, TrendingUp, Phone, Quote } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend } from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/seller/$sellerId")({
  component: SellerDetail,
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <p className="text-muted-foreground">Seller not found.</p>
        <Link to="/" className="mt-4 inline-block text-primary underline">Back to dashboard</Link>
      </div>
    </div>
  ),
});

function SellerDetail() {
  const { sellerId } = Route.useParams();
  const router = useRouter();
  const seller = getSeller(sellerId);

  if (!seller) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="text-center">
          <p className="text-muted-foreground">Seller not found.</p>
          <Button onClick={() => router.navigate({ to: "/" })} className="mt-4">Back to dashboard</Button>
        </div>
      </div>
    );
  }

  const band = riskBand(seller.riskScore);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to cohort
          </Link>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
                {seller.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{seller.name}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{seller.company} · {seller.city}</span>
                  <Badge variant="outline">{seller.packageType}</Badge>
                  <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${statusMeta[seller.status].className}`}>
                    {seller.status}
                  </span>
                  <span className="text-xs">· {statusMeta[seller.status].description}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-4 md:grid-cols-4">
          <Card className={band === "High" ? "border-destructive/40 bg-destructive/5" : band === "Medium" ? "border-warning/40 bg-warning/5" : "border-success/40 bg-success/5"}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4" /> Risk score
              </div>
              <p className="mt-2 text-4xl font-semibold tracking-tight">{seller.riskScore}<span className="text-lg text-muted-foreground">/100</span></p>
              <p className="mt-1 text-sm font-medium">{band} risk of churn</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Renewal date</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{(() => { const [y,m,d] = seller.renewalDate.split("-").map(Number); return `${d} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]} ${y}`; })()}</p>
              <p className="mt-1 text-sm text-muted-foreground">in {seller.daysToRenewal} days</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Annual revenue</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">₹{(seller.arr / 1000).toFixed(0)}k</p>
              <p className="mt-1 text-sm text-muted-foreground">{seller.category}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Seller ID</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{seller.id}</p>
              <p className="mt-1 text-sm text-muted-foreground">Active account</p>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-8">
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

        <Tabs defaultValue="behavior" className="mt-8">
          <TabsList className="h-auto flex-wrap gap-2 bg-transparent p-0">
            <TabsTrigger value="behavior" className="rounded-md border bg-background px-4 py-2 text-foreground shadow-sm hover:bg-muted data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:border-foreground">Past behaviour</TabsTrigger>
            <TabsTrigger value="leads" className="rounded-md border bg-background px-4 py-2 text-foreground shadow-sm hover:bg-muted data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:border-foreground">Indiamart Leads</TabsTrigger>
            <TabsTrigger value="calls" className="rounded-md border bg-background px-4 py-2 text-foreground shadow-sm hover:bg-muted data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:border-foreground">Call insights</TabsTrigger>
            <TabsTrigger value="guide" className="rounded-md border bg-background px-4 py-2 text-foreground shadow-sm hover:bg-muted data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:border-foreground">Retention guide</TabsTrigger>
          </TabsList>

          <TabsContent value="behavior" className="mt-4">
            <h2 className="mb-4 text-lg font-semibold tracking-tight">Behavior — past 3 months</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(seller.metrics) as Array<keyof Seller["metrics"]>).map((key) => (
                <MetricCard key={key} label={metricLabels[key]} data={seller.metrics[key]} invert={key === "retailBlRecommendedPct"} />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="leads" className="mt-4">
            <h2 className="mb-1 text-lg font-semibold tracking-tight">IndiaMART leads — past 6 months</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Monthly volume of buyer enquiries, Buy-Leads (BLs) consumed, and PNS calls received by {seller.name}.
            </p>
            <LeadsChart seller={seller} />
          </TabsContent>

          <TabsContent value="calls" className="mt-4">
            <h2 className="mb-1 text-lg font-semibold tracking-tight">Sales call insights</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Issues raised by the seller in recent calls with our exec — surfaced as potential churn drivers.
            </p>
            <CallInsightsList insights={seller.callInsights ?? []} />
          </TabsContent>

          <TabsContent value="guide" className="mt-4">
            <h2 className="mb-1 text-lg font-semibold tracking-tight">How to retain {seller.name}</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Talking points and actions tailored to this seller's recent behaviour.
            </p>
            <RetentionGuide seller={seller} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function buildReasons(s: Seller): string[] {
  const out: string[] = [];
  const m = s.metrics;
  const drop = (h: MetricHistory[]) => h[0].value - h[h.length - 1].value;
  const last = (h: MetricHistory[]) => h[h.length - 1].value;
  if (drop(m.loginPct) > 8) out.push(`Login activity dropped ${drop(m.loginPct)}% over 3 months (now ${last(m.loginPct)}%).`);
  if (drop(m.blConsumptionPct) > 8) out.push(`Buy-Lead consumption fell ${drop(m.blConsumptionPct)}% — seller not extracting value.`);
  if (drop(m.pnsPickupRatePct) > 6) out.push(`PNS pickup rate down to ${last(m.pnsPickupRatePct)}% — missing buyer calls.`);
  if (drop(m.lmsReplyRatePct) > 6) out.push(`LMS reply rate down to ${last(m.lmsReplyRatePct)}% — slow buyer response.`);
  if (last(m.retailBlRecommendedPct) > 50) out.push(`${last(m.retailBlRecommendedPct)}% of recommended BLs are retail — poor lead-fit.`);
  if (last(m.catalogScore) < 60) out.push(`Catalog score is ${last(m.catalogScore)} — listings need refresh.`);
  if (out.length === 0) out.push("Metrics are stable; flagged based on composite renewal-window risk.");
  return out;
}

type GuideSection = { title: string; pitch: string; actions: string[] };

function buildGuide(s: Seller): GuideSection[] {
  const m = s.metrics;
  const drop = (h: MetricHistory[]) => h[0].value - h[h.length - 1].value;
  const last = (h: MetricHistory[]) => h[h.length - 1].value;
  const out: GuideSection[] = [];

  if (drop(m.loginPct) > 8) out.push({
    title: "Re-engage on platform usage",
    pitch: `Login activity has slipped to ${last(m.loginPct)}%. Show ${s.name} the dashboard insights and unread buyer messages they're missing — frame inactivity as lost revenue, not as a complaint.`,
    actions: [
      "Walk through 2–3 hot buyer leads they haven't opened",
      "Enable mobile push and weekly digest emails",
      "Schedule a 15-min product re-onboarding call",
    ],
  });

  if (drop(m.blConsumptionPct) > 8) out.push({
    title: "Recover Buy-Lead value",
    pitch: `Buy-Lead consumption fell ${drop(m.blConsumptionPct)}% — they're paying for credits they aren't using. Position renewal as 'pay only for value delivered' with a tuned BL filter.`,
    actions: [
      "Audit and reset BL filters (category, geography, price range)",
      "Offer to top-up unused credits into next cycle",
      "Show ROI: BLs purchased vs. orders won in last 90 days",
    ],
  });

  if (drop(m.pnsPickupRatePct) > 6) out.push({
    title: "Fix missed buyer calls (PNS)",
    pitch: `Pickup rate is ${last(m.pnsPickupRatePct)}%. Every missed call is a lost order — tie this directly to revenue they could have closed.`,
    actions: [
      "Add a backup number / staff member to PNS routing",
      "Enable IVR + WhatsApp fallback for missed calls",
      "Share the count of missed enquiries last month",
    ],
  });

  if (drop(m.lmsReplyRatePct) > 6) out.push({
    title: "Speed up lead replies (LMS)",
    pitch: `LMS reply rate is ${last(m.lmsReplyRatePct)}%. Buyers contact 3–4 sellers — slow replies kill conversion.`,
    actions: [
      "Set up quick-reply templates for top 5 enquiry types",
      "Assign LMS to a dedicated team member",
      "Enable SLA alerts for unanswered leads >2 hrs",
    ],
  });

  if (last(m.retailBlRecommendedPct) > 50) out.push({
    title: "Improve lead-fit quality",
    pitch: `${last(m.retailBlRecommendedPct)}% of recommended BLs are retail — wrong fit for a wholesaler. Show that we'll recalibrate, don't let them blame 'bad leads' for churn.`,
    actions: [
      "Re-tag product catalog as B2B / wholesale only",
      "Update minimum order quantity on listings",
      "Re-run BL recommendation engine after recalibration",
    ],
  });

  if (last(m.catalogScore) < 60) out.push({
    title: "Refresh the catalog",
    pitch: `Catalog score is ${last(m.catalogScore)}. Poor listings = fewer buyer enquiries = they think IndiaMART isn't working.`,
    actions: [
      "Offer free professional photoshoot / image enhancement",
      "Add missing specs, GST, certifications on top 10 SKUs",
      "Promote 2–3 best-sellers to featured placements",
    ],
  });

  if (out.length === 0) out.push({
    title: "Reinforce the relationship",
    pitch: `${s.name} is performing well. Use this renewal as a chance to upsell, not defend — they're a candidate for a higher package.`,
    actions: [
      "Share a success summary: leads won, orders, ROI",
      "Pitch upgrade to next package tier with added benefits",
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
      {sections.map((sec, i) => (
        <div key={i} className="rounded-md border p-3">
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
    </div>
  );
}


function MetricCard({ label, data, invert }: { label: string; data: MetricHistory[]; invert?: boolean }) {
  const first = data[0].value;
  const last = data[data.length - 1].value;
  const delta = last - first;
  const isBad = invert ? delta > 0 : delta < 0;
  const TrendIcon = delta >= 0 ? TrendingUp : TrendingDown;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">{last}{label.includes("Score") ? "" : "%"}</p>
          </div>
          <div className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${isBad ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"}`}>
            <TrendIcon className="h-3 w-3" />
            {delta > 0 ? "+" : ""}{delta}
          </div>
        </div>
        <div className="mt-4 h-24">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "var(--foreground)" }}
              />
              <Line type="monotone" dataKey="value" stroke={isBad ? "var(--destructive)" : "var(--success)"} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

const sentimentStyle: Record<CallInsight["sentiment"], string> = {
  Negative: "bg-destructive/15 text-destructive border-destructive/30",
  Neutral: "bg-muted text-muted-foreground border-border",
  Positive: "bg-success/15 text-success border-success/30",
};

function CallInsightsList({ insights }: { insights: CallInsight[] }) {
  if (insights.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No call recordings analysed yet for this seller.
        </CardContent>
      </Card>
    );
  }

  const allIssues = Array.from(new Set(insights.flatMap((c) => c.issues)));

  return (
    <div className="space-y-4">
      {allIssues.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6">
            <p className="text-sm font-semibold">Recurring concerns from calls</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {allIssues.map((iss) => (
                <span key={iss} className="rounded-md border border-destructive/30 bg-background px-2 py-1 text-xs font-medium text-destructive">
                  {iss}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {insights.map((c) => {
          const [y, m, d] = c.date.split("-").map(Number);
          const dateLabel = `${d} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]} ${y}`;
          return (
            <Card key={c.id}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{dateLabel}</span>
                    <span className="text-muted-foreground">· {c.durationMin} min · {c.agent}</span>
                  </div>
                  <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${sentimentStyle[c.sentiment]}`}>
                    {c.sentiment}
                  </span>
                </div>
                <p className="mt-3 text-sm">{c.summary}</p>
                {c.quote && (
                  <div className="mt-3 flex gap-2 rounded-md border-l-2 border-destructive bg-muted/40 p-2 text-sm italic text-muted-foreground">
                    <Quote className="h-3.5 w-3.5 shrink-0 text-destructive" />
                    <span>"{c.quote}"</span>
                  </div>
                )}
                {c.issues.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {c.issues.map((iss) => (
                      <span key={iss} className="rounded border bg-background px-1.5 py-0.5 text-xs text-foreground">
                        {iss}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function LeadsChart({ seller }: { seller: Seller }) {
  // Derive 6 months of leads data deterministically from seller id + behaviour metrics.
  const months = ["Dec", "Jan", "Feb", "Mar", "Apr", "May"];
  const seed = seller.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const wiggle = (i: number, k: number) => {
    const x = Math.sin(seed * 13.37 + i * 7.7 + k * 3.3) * 1000;
    return Math.round((x - Math.floor(x)) * 20 - 10);
  };
  const blLatest = seller.metrics.blConsumptionPct[seller.metrics.blConsumptionPct.length - 1].value;
  const pnsLatest = seller.metrics.pnsPickupRatePct[seller.metrics.pnsPickupRatePct.length - 1].value;
  const baseEnq = 80 + Math.round(seller.arr / 4000);
  const trendFactor = (seller.riskScore > 55 ? -1 : seller.riskScore > 30 ? -0.4 : 0.3);

  const data = months.map((m, i) => {
    const drift = Math.round(trendFactor * i * 6);
    const enquiries = Math.max(10, baseEnq + drift + wiggle(i, 1));
    const bls = Math.max(5, Math.round(enquiries * (blLatest / 100)) + wiggle(i, 2));
    const pnsCalls = Math.max(5, Math.round(enquiries * (pnsLatest / 100) * 0.8) + wiggle(i, 3));
    return { month: m, enquiries, bls, pnsCalls };
  });

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "var(--foreground)" }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="enquiries" name="Enquiries" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="bls" name="Buy-Leads" stroke="var(--warning)" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="pnsCalls" name="PNS calls" stroke="var(--success)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
