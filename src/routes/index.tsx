import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { sellers, riskBand, statusMeta, type Seller, type SellerStatus } from "@/lib/mock-sellers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, TrendingDown, Users, IndianRupee, Search, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Seller Churn Early Warning — IndiaMART" },
      { name: "description", content: "Identify at-risk sellers up for renewal in the next 90 days." },
    ],
  }),
  component: Dashboard,
});

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

function Dashboard() {
  const [query, setQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [pkgFilter, setPkgFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    return sellers.filter((s) => {
      const q = query.toLowerCase();
      const matchQ = !q || s.name.toLowerCase().includes(q) || s.company.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
      const matchR = riskFilter === "all" || riskBand(s.riskScore) === riskFilter;
      const matchP = pkgFilter === "all" || s.packageType === pkgFilter;
      const matchS = statusFilter === "all" || s.status === statusFilter;
      return matchQ && matchR && matchP && matchS;
    });
  }, [query, riskFilter, pkgFilter, statusFilter]);

  const stats = useMemo(() => {
    const high = sellers.filter((s) => riskBand(s.riskScore) === "High");
    const med = sellers.filter((s) => riskBand(s.riskScore) === "Medium");
    const arrAtRisk = high.reduce((sum, s) => sum + s.arr, 0);
    return { total: sellers.length, high: high.length, med: med.length, arrAtRisk };
  }, []);

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
              <p className="text-xs text-muted-foreground">Cohort</p>
              <p className="text-sm font-medium">Renewal due in exactly 90 days</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard icon={Users} label="Sellers in cohort" value={String(stats.total)} sub="Renewal in exactly 90 days" />
          <StatCard icon={AlertTriangle} label="High risk" value={String(stats.high)} sub={`${Math.round((stats.high / stats.total) * 100)}% of cohort`} />
          <StatCard icon={TrendingDown} label="Medium risk" value={String(stats.med)} sub="Watch closely" />
          <StatCard icon={IndianRupee} label="ARR at risk" value={`₹${(stats.arrAtRisk / 100000).toFixed(1)}L`} sub="From high-risk sellers" />
        </div>

        <Card className="mt-8">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">At-risk sellers</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search seller / company / ID"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full pl-9 sm:w-64"
                />
              </div>
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger className="sm:w-36"><SelectValue placeholder="Risk" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All risk</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Medium">Medium</SelectItem>
                  <SelectItem value="Low">Low</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="sm:w-36"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  {(Object.keys(statusMeta) as SellerStatus[]).map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={pkgFilter} onValueChange={setPkgFilter}>
                <SelectTrigger className="sm:w-36"><SelectValue placeholder="Package" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All packages</SelectItem>
                  <SelectItem value="Star">Star</SelectItem>
                  <SelectItem value="Platinum">Platinum</SelectItem>
                  <SelectItem value="Gold">Gold</SelectItem>
                  <SelectItem value="Silver">Silver</SelectItem>
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
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => (
                    <SellerRow key={s.id} seller={s} />
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
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
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
            {s.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
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
