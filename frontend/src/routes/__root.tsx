import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { PanelLeft, Settings, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { fetchSellers } from "@/lib/api";
import { riskBand, type Seller } from "@/lib/mock-sellers";

import appCss from "../styles.css?url";

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewType = "churn" | "platform" | "upsell";

type RootLoaderData = {
  sellers: Seller[];
};

// ─── Error / NotFound ─────────────────────────────────────────────────────────

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            search={{ view: "churn" }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async (): Promise<RootLoaderData> => {
    try {
      const sellers = await fetchSellers();
      return { sellers };
    } catch {
      return { sellers: [] };
    }
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Seller Churn Early Warning — IndiaMART" },
      { name: "description", content: "Early warning system for IndiaMART sellers at risk of churn." },
      { property: "og:title", content: "Seller Churn Early Warning" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// ─── Shell ────────────────────────────────────────────────────────────────────

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function NavItem({
  view,
  label,
  icon: Icon,
  count,
  badgeColor,
  currentView,
  isHome,
}: {
  view: ViewType;
  label: string;
  icon: typeof Settings;
  count?: number;
  badgeColor?: string;
  currentView: string;
  isHome: boolean;
}) {
  const active = isHome && currentView === view;
  return (
    <Link
      to="/"
      search={{ view } as { view: ViewType }}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150 group ${
        active
          ? "bg-white/10 text-white"
          : "text-zinc-400 hover:text-white hover:bg-white/5"
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 transition-colors ${active ? "text-white" : "text-zinc-500 group-hover:text-zinc-300"}`} />
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${badgeColor ?? "bg-zinc-700"} text-white`}>
          {count}
        </span>
      )}
    </Link>
  );
}

function AppSidebar({ onCollapse }: { onCollapse: () => void }) {
  const { sellers } = Route.useLoaderData();
  const location = useRouterState({ select: (s) => s.location });
  const currentView = ((location.search as { view?: string }).view ?? "churn") as ViewType;
  const isHome = location.pathname === "/";

  const churnCount = sellers.filter((s) => s.churnCause !== "PLATFORM_FAILURE").length;
  const platformCount = sellers.filter((s) => s.churnCause === "PLATFORM_FAILURE").length;
  const upsellCount = sellers.filter((s) => s.riskScore < 55 && s.packageType !== "Star" && s.churnCause !== "PLATFORM_FAILURE").length;

  return (
    <aside className="w-[220px] shrink-0 bg-zinc-950 flex flex-col overflow-y-auto border-r border-zinc-800">
      {/* Brand */}
      <div className="px-4 py-5 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold shrink-0">
            C
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-sm font-semibold text-white leading-none truncate">ChurnGuard</p>
            <p className="text-[10px] text-zinc-500 mt-0.5 truncate">IndiaMART · Sales</p>
          </div>
          <button
            onClick={onCollapse}
            className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
            title="Collapse sidebar"
          >
            <PanelLeft className="h-4 w-4 text-zinc-400" />
          </button>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-5 pb-4">
        <div>
          <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Operations
          </p>
          <div className="space-y-0.5">
            <NavItem
              view="churn"
              label="Seller Churn"
              icon={TrendingDown}
              count={churnCount}
              badgeColor="bg-red-800"
              currentView={currentView}
              isHome={isHome}
            />
            <NavItem
              view="platform"
              label="Platform Issues"
              icon={Settings}
              count={platformCount}
              badgeColor="bg-orange-700"
              currentView={currentView}
              isHome={isHome}
            />
            <NavItem
              view="upsell"
              label="Upselling"
              icon={TrendingUp}
              count={upsellCount}
              badgeColor="bg-green-700"
              currentView={currentView}
              isHome={isHome}
            />
          </div>
        </div>

        <div>
          <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Product
          </p>
          <div className="space-y-0.5">
            <Link
              to="/showcase"
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150 group ${
                location.pathname === "/showcase"
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <Sparkles className={`h-4 w-4 shrink-0 transition-colors ${location.pathname === "/showcase" ? "text-white" : "text-zinc-500 group-hover:text-zinc-300"}`} />
              <span className="flex-1 truncate">Showcase</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-zinc-800 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-semibold text-white shrink-0">
            SC
          </div>
          <div className="overflow-hidden">
            <p className="text-xs font-medium text-white truncate">Sales Command</p>
            <p className="text-[10px] text-zinc-500 truncate">IndiaMART</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isShowcase = pathname === "/showcase";
  // Sidebar hidden — set to true to restore
  const [sidebarOpen] = useState(false);

  return (
    <QueryClientProvider client={queryClient}>
      {isShowcase ? (
        <Outlet />
      ) : (
        <div className="flex flex-col h-screen overflow-hidden">
          {/* Top accent stripe — spans full width above sidebar + content */}
          <div className="h-[3px] bg-gradient-to-r from-primary/40 via-primary to-primary/40 shrink-0" />

          <div className="flex flex-1 overflow-hidden relative">
            {sidebarOpen && <AppSidebar onCollapse={() => {}} />}
            <main className="flex-1 overflow-y-auto bg-gradient-to-b from-muted/20 to-muted/40 [scrollbar-gutter:stable]">
              <Outlet />
            </main>
          </div>
        </div>
      )}
    </QueryClientProvider>
  );
}
