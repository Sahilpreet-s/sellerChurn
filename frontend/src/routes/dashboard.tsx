import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import {
  riskBand, statusMeta, churnCauseMeta,
  type Seller, type SellerStatus, type ChurnCause,
} from "@/lib/mock-sellers";
import { fetchSellers } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertTriangle, TrendingDown, TrendingUp, Users, IndianRupee,
  Search, ChevronRight, ChevronLeft, Settings, Sparkles,
} from "lucide-react";

// ─── View type ────────────────────────────────────────────────────────────────

type ViewType = "churn" | "platform" | "upsell";

// ─── 3D tilt hook ─────────────────────────────────────────────────────────────

function useTilt(strength = 7) {
  const ref = useRef<HTMLDivElement>(null);
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const { left, top, width, height } = el.getBoundingClientRect();
    const x = ((e.clientX - left) / width - 0.5) * strength;
    const y = ((e.clientY - top) / height - 0.5) * -strength;
    el.style.setProperty("--rx", `${y}deg`);
    el.style.setProperty("--ry", `${x}deg`);
  }, [strength]);
  const onMouseLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  }, []);
  return { ref, onMouseMove, onMouseLeave };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/dashboard")({
  validateSearch: (search: Record<string, unknown>): { view: ViewType } => {
    const v = search.view;
    if (v === "platform" || v === "upsell") return { view: v };
    return { view: "churn" };
  },
  head: () => ({
    meta: [
      { title: "Seller Churn Early Warning — IndiaMART" },
      { name: "description", content: "Identify at-risk sellers up for renewal in the next 90 days." },
    ],
  }),
  loader: async () => {
    try {
      const sellers = await fetchSellers();
      return { sellers, fromAPI: true };
    } catch {
      return { sellers: [] as Seller[], fromAPI: false };
    }
  },
  component: Dashboard,
});

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 5;
const CHURN_CAUSES: ChurnCause[] = ["BEHAVIORAL", "EXTERNAL", "MIXED"];

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

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, delay = 0 }: {
  icon: typeof Users; label: string; value: string; sub?: string; delay?: number;
}) {
  const tilt = useTilt(6);
  return (
    <div
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      className="tilt-card animate-slide-in-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <Card className="border shadow-sm hover:shadow-xl transition-shadow duration-300 overflow-hidden relative cursor-default select-none">
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-muted/40 pointer-events-none" />
        <CardContent className="pt-4 relative">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
              {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
            </div>
            <div className="rounded-xl bg-gradient-to-br from-primary/25 to-primary/5 p-2.5 text-primary shadow-sm ring-1 ring-primary/10">
              <Icon className="h-5 w-5" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Cause badge ──────────────────────────────────────────────────────────────

function ChurnCauseBadge({ cause }: { cause: ChurnCause }) {
  const meta = churnCauseMeta[cause];
  return (
    <span
      className={`rounded-md border px-2 py-0.5 text-xs font-medium transition-all duration-150 hover:scale-105 ${meta.className}`}
      title={meta.description}
    >
      {meta.label}
    </span>
  );
}

// ─── Paginator ────────────────────────────────────────────────────────────────

function Paginator({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) return null;

  const pages: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }

  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="flex items-center justify-between border-t pt-4 mt-2">
      <p className="text-sm text-muted-foreground">
        Showing {start}–{end} of {total} sellers
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page === 1}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border text-sm transition-all duration-150 hover:bg-muted hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="h-8 w-8 flex items-center justify-center text-muted-foreground text-sm select-none">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onChange(p as number)}
              className={`h-8 w-8 rounded-lg border text-sm font-medium transition-all duration-150 hover:scale-105 ${
                p === page ? "bg-foreground text-background border-foreground shadow-sm scale-105" : "hover:bg-muted"
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => onChange(page + 1)}
          disabled={page === Math.ceil(total / PAGE_SIZE)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border text-sm transition-all duration-150 hover:bg-muted hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Context callouts ─────────────────────────────────────────────────────────

function PlatformCallout() {
  return (
    <div className="animate-slide-in-up rounded-xl border border-orange-300/50 bg-gradient-to-r from-orange-50 to-amber-50/30 px-5 py-4 flex items-start gap-3">
      <div className="h-9 w-9 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
        <Settings className="h-4 w-4 text-orange-600" />
      </div>
      <div>
        <p className="text-sm font-semibold text-orange-800">Product team action required</p>
        <p className="mt-0.5 text-xs text-orange-700/70 leading-relaxed">
          These sellers are at risk due to systemic IndiaMART platform issues — not seller-side problems.
          Schedule retention calls only after the root cause is resolved by Engineering.
        </p>
      </div>
    </div>
  );
}

function UpsellCallout() {
  return (
    <div className="animate-slide-in-up rounded-xl border border-success/30 bg-gradient-to-r from-success/5 to-transparent px-5 py-4 flex items-start gap-3">
      <div className="h-9 w-9 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
        <TrendingUp className="h-4 w-4 text-success" />
      </div>
      <div>
        <p className="text-sm font-semibold text-success">Growth opportunity pipeline</p>
        <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
          These sellers show stable engagement and low churn risk — ideal candidates for package upgrades.
          Raise upgrade conversations during renewal to grow their subscription tier.
        </p>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
  const { sellers, fromAPI } = Route.useLoaderData();
  const { view } = Route.useSearch();

  const [query, setQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [pkgFilter, setPkgFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [causeFilter, setCauseFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const tableRef = useRef<HTMLDivElement>(null);

  const isViewSeller = useCallback((s: Seller) => {
    if (view === "platform") return s.churnCause === "PLATFORM_FAILURE";
    if (view === "upsell") return s.riskScore < 55 && s.packageType !== "Star" && s.churnCause !== "PLATFORM_FAILURE";
    return (CHURN_CAUSES as string[]).includes(s.churnCause);
  }, [view]);

  const filtered = useMemo(() => {
    return sellers.filter((s) => {
      if (!isViewSeller(s)) return false;
      const q = query.toLowerCase();
      const matchQ = !q || s.name.toLowerCase().includes(q) || s.company.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
      const matchR = riskFilter === "all" || riskBand(s.riskScore) === riskFilter;
      const matchP = pkgFilter === "all" || s.packageType === pkgFilter;
      const matchS = statusFilter === "all" || s.status === statusFilter;
      const matchC = view !== "churn" || causeFilter === "all" || s.churnCause === causeFilter;
      return matchQ && matchR && matchP && matchS && matchC;
    });
  }, [sellers, query, riskFilter, pkgFilter, statusFilter, causeFilter, view, isViewSeller]);

  useEffect(() => { setPage(1); }, [query, riskFilter, pkgFilter, statusFilter, causeFilter, view]);

  useEffect(() => {
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [page]);

  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const viewSellers = useMemo(() => sellers.filter(isViewSeller), [sellers, isViewSeller]);
  const computedStats = useMemo(() => {
    const vs = viewSellers;
    return {
      total: vs.length,
      high: vs.filter((s) => riskBand(s.riskScore) === "High").length,
      medium: vs.filter((s) => riskBand(s.riskScore) === "Medium").length,
      low: vs.filter((s) => riskBand(s.riskScore) === "Low").length,
      entry: vs.filter((s) => s.packageType === "Catalog" || s.packageType === "Silver").length,
      arrAtRisk: vs.filter((s) => riskBand(s.riskScore) === "High").reduce((sum, s) => sum + s.arr, 0),
      totalArr: vs.reduce((sum, s) => sum + s.arr, 0),
    };
  }, [viewSellers]);

  const pageTitle = view === "platform" ? "Platform Issues Dashboard"
                  : view === "upsell"   ? "Upsell Opportunities Dashboard"
                  : "Seller Churn Dashboard";

  return (
    <div>
      <header className="border-b border-border/50 bg-background/70 backdrop-blur-xl sticky top-0 z-20">
        <div className="flex items-center gap-2.5 px-6 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background shrink-0">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">ChurnGuard</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-sm text-muted-foreground">{pageTitle}</span>
        </div>
      </header>

      <div className="px-6 py-4 space-y-4">
        {view === "platform" && <PlatformCallout />}

        {view === "upsell"   && <UpsellCallout />}

        <div className="grid gap-4 md:grid-cols-4">
          {view === "upsell" ? (
            <>
              <StatCard icon={TrendingUp}   label="Upsell candidates"      value={String(computedStats.total)}  delay={0} />
              <StatCard icon={Users}        label="Low risk"                value={String(computedStats.low)}    sub="Stable engagement" delay={80} />
              <StatCard icon={TrendingDown} label="Entry packages"          value={String(computedStats.entry)}  sub="Catalog / Silver" delay={160} />
              <StatCard icon={IndianRupee}  label="Pipeline ARR"            value={`₹${(computedStats.totalArr / 100000).toFixed(1)}L`} sub="Current subscription value" delay={240} />
            </>
          ) : (
            <>
              <StatCard icon={Users}         label="Sellers in cohort" value={String(computedStats.total)}  sub="Renewing within 90 days" delay={0} />
              <StatCard icon={AlertTriangle} label="High risk"          value={String(computedStats.high)}   sub={computedStats.total > 0 ? `${Math.round((computedStats.high / computedStats.total) * 100)}% of cohort` : undefined} delay={80} />
              <StatCard icon={TrendingDown}  label="Medium risk"        value={String(computedStats.medium)} sub="Watch closely" delay={160} />
              <StatCard icon={IndianRupee}   label="ARR at risk"        value={`₹${(computedStats.arrAtRisk / 100000).toFixed(1)}L`} sub="From high-risk sellers" delay={240} />
            </>
          )}
        </div>

        <div ref={tableRef}>
          <Card className="border shadow-sm animate-fade-in-scale overflow-hidden">
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-gradient-to-r from-background to-muted/30">
              <CardTitle className="text-base">
                {view === "upsell" ? "Upgrade candidates" : "At-risk sellers"}
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search seller / company / ID"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full pl-9 sm:w-52"
                  />
                </div>
                <Select value={riskFilter} onValueChange={setRiskFilter}>
                  <SelectTrigger className="sm:w-28"><SelectValue placeholder="Risk" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All risk</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="Low">Low</SelectItem>
                  </SelectContent>
                </Select>
                {view === "churn" && (
                  <Select value={causeFilter} onValueChange={setCauseFilter}>
                    <SelectTrigger className="sm:w-32"><SelectValue placeholder="Cause" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All causes</SelectItem>
                      <SelectItem value="BEHAVIORAL">Behavioural</SelectItem>
                      <SelectItem value="EXTERNAL">External</SelectItem>
                      <SelectItem value="MIXED">Mixed</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="sm:w-28"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All status</SelectItem>
                    {(Object.keys(statusMeta) as SellerStatus[]).map((k) => (
                      <SelectItem key={k} value={k}>{k}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={pkgFilter} onValueChange={setPkgFilter}>
                  <SelectTrigger className="sm:w-28"><SelectValue placeholder="Package" /></SelectTrigger>
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
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Seller</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Package</TableHead>
                      <TableHead>Renewal</TableHead>
                      <TableHead className="text-right">ARR</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead>Cause</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.map((s, i) => <SellerRow key={s.id} seller={s} index={i} />)}
                    {paginated.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                          {!fromAPI
                            ? "Backend unavailable — start the Go server to load seller data."
                            : "No sellers match these filters."}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <Paginator page={page} total={filtered.length} onChange={setPage} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Seller row ───────────────────────────────────────────────────────────────

function SellerRow({ seller: s, index }: { seller: Seller; index: number }) {
  const band = riskBand(s.riskScore);
  return (
    <TableRow
      className="group animate-slide-in-up transition-colors duration-150 hover:bg-primary/5"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-sm font-medium text-primary ring-1 ring-primary/10 transition-all duration-200 group-hover:ring-2 group-hover:ring-primary/30 group-hover:shadow-sm">
            {s.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            {s.priorChurn && (
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-destructive border-2 border-background" title="Prior churn" />
            )}
          </div>
          <div>
            <p className="font-medium transition-colors duration-150 group-hover:text-primary">{s.name}</p>
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
        <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${riskColor(band)} ${band === "High" ? "risk-high-badge" : ""}`}>
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
          className="inline-flex items-center text-sm text-primary opacity-40 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0.5"
        >
          <ChevronRight className="h-5 w-5" />
        </Link>
      </TableCell>
    </TableRow>
  );
}
