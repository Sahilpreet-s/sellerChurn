import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { sellers as mockSellers, riskBand, statusMeta, churnCauseMeta, type Seller, type SellerStatus, type ChurnCause } from "@/lib/mock-sellers";
import { fetchSellers, fetchStats, fetchPatterns, type PatternAlert, type DashboardStats } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, TrendingDown, Users, IndianRupee, Search, ChevronRight } from "lucide-react";

// ─── Loader ───────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Seller Churn Early Warning — IndiaMART" },
      { name: "description", content: "Identify at-risk sellers up for renewal in the next 90 days." },
    ],
  }),
  loader: async () => {
    try {
      const [sellers, stats, patterns] = await Promise.all([
        fetchSellers(),
        fetchStats(),
        fetchPatterns(),
      ]);
      return { sellers, stats, patterns, fromAPI: true };
    } catch {
      // Fallback to mock data when API is not running
      const high = mockSellers.filter(s => riskBand(s.riskScore) === "High");
      const med = mockSellers.filter(s => riskBand(s.riskScore) === "Medium");
      const arrAtRisk = high.reduce((sum, s) => sum + s.arr, 0);
      const stats: DashboardStats = {
        total: mockSellers.length, high: high.length, medium: med.length,
        low: mockSellers.filter(s => riskBand(s.riskScore) === "Low").length,
        arrAtRisk, cohortDate: "2026-08-13",
      };
      return { sellers: mockSellers, stats, patterns: [] as PatternAlert[], fromAPI: false };
    }
  },
  component: Dashboard,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function formatRenewal(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function riskColor(band: "High" | "Medium" | "Low") {
  if (band === "High") return "bg-destructive/15 text-destructive border-destructive/30";
  if (band === "Medium") return "bg-warning/15 text-warning border-warning/30";
  return "bg-success/15 text-success border-success/30";
}

// ─── Components ───────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub }: { icon: typeof Users; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
            {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChurnCauseBadge({ cause }: { cause: ChurnCause }) {
  const meta = churnCauseMeta[cause];
  return (
    <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${meta.className}`} title={meta.description}>
      {meta.label}
    </span>
  );
}

function PatternAlertsBanner({ patterns }: { patterns: PatternAlert[] }) {
  if (patterns.length === 0) return null;
  return (
    <div className="space-y-2">
      {patterns.map((p) => (
        <div
          key={p.id}
          className={`rounded-md border px-4 py-3 flex items-start gap-3 text-sm ${
            p.severity === "High"
              ? "border-destructive/40 bg-destructive/5"
              : "border-warning/40 bg-warning/5"
          }`}
        >
          <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${p.severity === "High" ? "text-destructive" : "text-warning"}`} />
          <div>
            <span className="font-semibold">{p.title}:</span>{" "}
            <span className="text-muted-foreground">{p.narrative}</span>
            {p.affectedIds.length > 0 && (
              <span className="ml-2 text-xs text-muted-foreground">
                Affected: {p.affectedIds.slice(0, 5).join(", ")}{p.affectedIds.length > 5 ? ` +${p.affectedIds.length - 5}` : ""}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
  const { sellers, stats, patterns, fromAPI } = Route.useLoaderData();

  const [query, setQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [pkgFilter, setPkgFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [causeFilter, setCauseFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    return sellers.filter((s) => {
      const q = query.toLowerCase();
      const matchQ = !q || s.name.toLowerCase().includes(q) || s.company.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
      const matchR = riskFilter === "all" || riskBand(s.riskScore) === riskFilter;
      const matchP = pkgFilter === "all" || s.packageType === pkgFilter;
      const matchS = statusFilter === "all" || s.status === statusFilter;
      const matchC = causeFilter === "all" || s.churnCause === causeFilter;
      return matchQ && matchR && matchP && matchS && matchC;
    });
  }, [sellers, query, riskFilter, pkgFilter, statusFilter, causeFilter]);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">IndiaMART · Sales Command</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Seller Churn Early Warning</h1>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2 justify-end">
                <div className={`h-2 w-2 rounded-full ${fromAPI ? "bg-success" : "bg-muted-foreground"}`} />
                <p className="text-xs text-muted-foreground">{fromAPI ? "Live API" : "Mock data"}</p>
              </div>
              <p className="text-sm font-medium mt-0.5">Renewal due in exactly 90 days</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        {/* Pattern Alerts */}
        <PatternAlertsBanner patterns={patterns} />

        {/* Stat cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard icon={Users}         label="Sellers in cohort" value={String(stats.total)}        sub="Renewal in exactly 90 days" />
          <StatCard icon={AlertTriangle} label="High risk"          value={String(stats.high)}         sub={`${Math.round((stats.high / stats.total) * 100)}% of cohort`} />
          <StatCard icon={TrendingDown}  label="Medium risk"        value={String(stats.medium)}       sub="Watch closely" />
          <StatCard icon={IndianRupee}   label="ARR at risk"        value={`₹${(stats.arrAtRisk / 100000).toFixed(1)}L`} sub="From high-risk sellers" />
        </div>

        {/* Seller table */}
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">At-risk sellers</CardTitle>
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search seller / company / ID"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full pl-9 sm:w-56"
                />
              </div>
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger className="sm:w-32"><SelectValue placeholder="Risk" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All risk</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Medium">Medium</SelectItem>
                  <SelectItem value="Low">Low</SelectItem>
                </SelectContent>
              </Select>
              <Select value={causeFilter} onValueChange={setCauseFilter}>
                <SelectTrigger className="sm:w-36"><SelectValue placeholder="Cause" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All causes</SelectItem>
                  <SelectItem value="BEHAVIORAL">Behavioural</SelectItem>
                  <SelectItem value="PLATFORM_FAILURE">Platform</SelectItem>
                  <SelectItem value="EXTERNAL">External</SelectItem>
                  <SelectItem value="MIXED">Mixed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="sm:w-32"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  {(Object.keys(statusMeta) as SellerStatus[]).map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={pkgFilter} onValueChange={setPkgFilter}>
                <SelectTrigger className="sm:w-32"><SelectValue placeholder="Package" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All packages</SelectItem>
                  <SelectItem value="Star">Star</SelectItem>
                  <SelectItem value="Platinum">Platinum</SelectItem>
                  <SelectItem value="Gold">Gold</SelectItem>
                  <SelectItem value="Silver">Silver</SelectItem>
                  <SelectItem value="Catalog">Catalog</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Seller</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Package</TableHead>
                    <TableHead>Renewal</TableHead>
                    <TableHead className="text-right">ARR</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Cause</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => <SellerRow key={s.id} seller={s} />)}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                        No sellers match these filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function SellerRow({ seller: s }: { seller: Seller }) {
  const band = riskBand(s.riskScore);
  return (
    <TableRow className="group">
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
            {s.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            {s.priorChurn && (
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-destructive border-2 border-background" title="Prior churn" />
            )}
          </div>
          <div>
            <p className="font-medium">{s.name}</p>
            <p className="text-xs text-muted-foreground">{s.company} · {s.city} · {s.id}</p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${statusMeta[s.status].className}`}>
          {s.status}
        </span>
      </TableCell>
      <TableCell><Badge variant="outline">{s.packageType}</Badge></TableCell>
      <TableCell>
        <p className="text-sm">{formatRenewal(s.renewalDate)}</p>
        <p className="text-xs text-muted-foreground">in {s.daysToRenewal} days</p>
      </TableCell>
      <TableCell className="text-right font-medium">₹{(s.arr / 1000).toFixed(0)}k</TableCell>
      <TableCell>
        <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${riskColor(band)}`}>
          {band} · {s.riskScore}
        </span>
      </TableCell>
      <TableCell>
        <ChurnCauseBadge cause={s.churnCause} />
      </TableCell>
      <TableCell>
        <Link
          to="/seller/$sellerId"
          params={{ sellerId: s.id }}
          className="inline-flex items-center text-sm text-primary opacity-60 transition group-hover:opacity-100"
        >
          <ChevronRight className="h-5 w-5" />
        </Link>
      </TableCell>
    </TableRow>
  );
}
