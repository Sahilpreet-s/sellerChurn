import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useScroll, useTransform, useInView, type Variants } from "framer-motion";
import { useRef } from "react";
import {
  AlertTriangle, TrendingDown, PhoneCall, BarChart3, Users, IndianRupee,
  ShieldCheck, Sparkles, ArrowRight, LineChart, Filter, Search, Bell,
  MessageSquare, Target, Zap, CheckCircle2,
} from "lucide-react";

export const Route = createFileRoute("/showcase")({
  head: () => ({
    meta: [
      { title: "Product Showcase — Seller Churn Early Warning" },
      { name: "description", content: "An animated walkthrough of every feature: risk scoring, call insights, retention guides and live dashboards." },
      { property: "og:title", content: "Product Showcase — Seller Churn Early Warning" },
      { property: "og:description", content: "An animated walkthrough of every feature in the IndiaMART seller churn early warning system." },
    ],
  }),
  component: ShowcasePage,
});

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 32 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } },
};

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });
  return (
    <motion.section
      ref={ref}
      variants={stagger}
      initial="hidden"
      animate={inView ? "show" : "hidden"}
      className={className}
    >
      {children}
    </motion.section>
  );
}

function ShowcasePage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 200]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* NAV */}
      <nav className="fixed top-0 z-50 w-full border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight">ChurnGuard</span>
          </div>
          <div className="hidden gap-8 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground transition">Features</a>
            <a href="#workflow" className="hover:text-foreground transition">Workflow</a>
            <a href="#insights" className="hover:text-foreground transition">Insights</a>
          </div>
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background hover:opacity-90 transition"
          >
            Open dashboard <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <header ref={heroRef} className="relative flex min-h-screen items-center justify-center overflow-hidden pt-20">
        {/* Animated gradient blobs */}
        <motion.div
          className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-destructive/20 blur-[120px]"
          animate={{ x: [0, 100, 0], y: [0, 60, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -bottom-40 -right-40 h-[600px] w-[600px] rounded-full bg-warning/20 blur-[120px]"
          animate={{ x: [0, -120, 0], y: [0, -80, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute top-1/3 left-1/2 h-[400px] w-[400px] rounded-full bg-success/15 blur-[100px]"
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        />

        <motion.div style={{ y: heroY, opacity: heroOpacity }} className="relative z-10 mx-auto max-w-5xl px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
            </span>
            Live churn intelligence for IndiaMART KAMs
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="mt-8 text-5xl font-semibold tracking-tight sm:text-7xl md:text-8xl"
          >
            Catch churn{" "}
            <span className="relative inline-block">
              <span className="relative z-10 italic font-light text-muted-foreground">before</span>
            </span>
            <br />
            it happens.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg"
          >
            A unified command center that fuses behavioural metrics, lead consumption,
            and live call transcripts into a single risk score &mdash; 90 days before renewal.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.5 }}
            className="mt-10 flex flex-wrap items-center justify-center gap-3"
          >
            <Link to="/" className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background hover:opacity-90 transition">
              Launch the dashboard <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#features" className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-medium hover:bg-muted transition">
              See features
            </a>
          </motion.div>

          {/* Floating metric pills */}
          <div className="relative mt-20 hidden md:block">
            <motion.div
              animate={{ y: [0, -12, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -left-8 top-0 rounded-2xl border border-border bg-background/80 p-4 shadow-xl backdrop-blur"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-destructive/15 p-2 text-destructive"><AlertTriangle className="h-4 w-4" /></div>
                <div className="text-left">
                  <p className="text-xs text-muted-foreground">High risk</p>
                  <p className="text-lg font-semibold">42 sellers</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              animate={{ y: [0, 12, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
              className="absolute -right-4 top-10 rounded-2xl border border-border bg-background/80 p-4 shadow-xl backdrop-blur"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-success/15 p-2 text-success"><IndianRupee className="h-4 w-4" /></div>
                <div className="text-left">
                  <p className="text-xs text-muted-foreground">ARR saved</p>
                  <p className="text-lg font-semibold">&#8377;1.2 Cr</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
              className="absolute left-1/2 top-24 -translate-x-1/2 rounded-2xl border border-border bg-background/80 p-4 shadow-xl backdrop-blur"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-warning/15 p-2 text-warning"><PhoneCall className="h-4 w-4" /></div>
                <div className="text-left">
                  <p className="text-xs text-muted-foreground">Calls flagged</p>
                  <p className="text-lg font-semibold">128 today</p>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>

        {/* Scroll hint */}
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 text-xs text-muted-foreground"
        >
          Scroll to explore
        </motion.div>
      </header>

      {/* MARQUEE STATS */}
      <Section className="border-y border-border bg-muted/30 py-10">
        <motion.div variants={fadeUp} className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-6 md:grid-cols-4">
          {[
            { v: "12+", l: "Behavioural signals" },
            { v: "90d", l: "Lead time before renewal" },
            { v: "3x", l: "Faster KAM triage" },
            { v: "97%", l: "Risk model precision" },
          ].map((s, i) => (
            <motion.div key={i} variants={fadeUp} className="text-center">
              <p className="text-4xl font-semibold tracking-tight">{s.v}</p>
              <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{s.l}</p>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* FEATURES GRID */}
      <Section className="mx-auto max-w-7xl px-6 py-32">
        <motion.div variants={fadeUp} className="max-w-2xl" id="features">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Everything in one place</p>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
            Every signal that matters, surfaced automatically.
          </h2>
          <p className="mt-4 text-muted-foreground">
            From login frequency to call sentiment &mdash; ChurnGuard pulls every behavioural and conversational
            signal into a single, ranked workspace.
          </p>
        </motion.div>

        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: AlertTriangle, title: "Risk scoring", desc: "0-100 score with High/Medium/Low bands derived from 12+ live signals." },
            { icon: BarChart3, title: "Past behaviour", desc: "Six-month trend graphs of logins, BL consumption and PNS pickup." },
            { icon: PhoneCall, title: "Call insights", desc: "Transcripts of executive calls with sentiment, issues and direct quotes." },
            { icon: LineChart, title: "Indiamart leads", desc: "Enquiries, Buy-Leads and PNS calls plotted month-on-month per seller." },
            { icon: ShieldCheck, title: "Retention guide", desc: "Tailored playbook with next-best-actions for every at-risk seller." },
            { icon: Filter, title: "Smart filters", desc: "Slice by risk band, package, status or KAM with instant results." },
          ].map((f, i) => (
            <motion.div
              key={i}
              variants={fadeUp}
              whileHover={{ y: -4 }}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card p-6 transition"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.02] to-transparent opacity-0 transition group-hover:opacity-100" />
              <div className="relative">
                <div className="inline-flex rounded-xl bg-muted p-3">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* WORKFLOW BENTO */}
      <Section className="bg-muted/30 py-32">
        <div className="mx-auto max-w-7xl px-6" id="workflow">
          <motion.div variants={fadeUp} className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">How it works</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
              From raw signal to retention action in seconds.
            </h2>
          </motion.div>

          <div className="mt-16 grid gap-4 md:grid-cols-6 md:grid-rows-2">
            {/* Big card: dashboard */}
            <motion.div variants={fadeUp} className="relative overflow-hidden rounded-3xl border border-border bg-card p-8 md:col-span-4 md:row-span-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Search className="h-3.5 w-3.5" /> Live cohort &mdash; renewal in 90 days
              </div>
              <h3 className="mt-3 text-2xl font-semibold">A ranked watch-list of every at-risk seller</h3>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Sortable, filterable, searchable. ARR-weighted so the biggest risks rise to the top.
              </p>

              {/* Mock table */}
              <div className="mt-8 space-y-2">
                {[
                  { n: "Rajesh Kumar", c: "Kumar Steel Industries", r: 78, b: "High" },
                  { n: "Priya Mehta", c: "Mehta Textiles Pvt Ltd", r: 64, b: "High" },
                  { n: "Anil Shah", c: "Shah Electronics", r: 47, b: "Medium" },
                  { n: "Sneha Reddy", c: "Reddy Polymers", r: 28, b: "Low" },
                ].map((row, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                    className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                        {row.n.split(" ").map(p => p[0]).join("")}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{row.n}</p>
                        <p className="text-xs text-muted-foreground">{row.c}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <motion.div
                          initial={{ width: 0 }}
                          whileInView={{ width: `${row.r}%` }}
                          viewport={{ once: true }}
                          transition={{ delay: 0.5 + i * 0.1, duration: 0.8 }}
                          className={`h-full ${row.b === "High" ? "bg-destructive" : row.b === "Medium" ? "bg-warning" : "bg-success"}`}
                        />
                      </div>
                      <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
                        row.b === "High" ? "border-destructive/30 bg-destructive/10 text-destructive"
                        : row.b === "Medium" ? "border-warning/30 bg-warning/10 text-warning"
                        : "border-success/30 bg-success/10 text-success"
                      }`}>{row.b} &middot; {row.r}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Risk score pill */}
            <motion.div variants={fadeUp} className="rounded-3xl border border-border bg-card p-6 md:col-span-2">
              <Target className="h-5 w-5 text-destructive" />
              <h3 className="mt-3 text-lg font-semibold">Risk score 0&ndash;100</h3>
              <div className="mt-6 flex items-end gap-2">
                <motion.span
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  className="text-6xl font-semibold tracking-tight text-destructive"
                >78</motion.span>
                <span className="mb-2 text-xs text-muted-foreground">High risk</span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                <motion.div
                  initial={{ width: 0 }}
                  whileInView={{ width: "78%" }}
                  viewport={{ once: true }}
                  transition={{ duration: 1.2, ease: "easeOut" }}
                  className="h-full bg-gradient-to-r from-success via-warning to-destructive"
                />
              </div>
            </motion.div>

            {/* Call insight */}
            <motion.div variants={fadeUp} className="rounded-3xl border border-border bg-card p-6 md:col-span-2">
              <MessageSquare className="h-5 w-5" />
              <h3 className="mt-3 text-lg font-semibold">From the latest call</h3>
              <p className="mt-3 border-l-2 border-destructive pl-3 text-sm italic text-muted-foreground">
                "Buy-leads dropped sharply and competitor outreach increased."
              </p>
              <p className="mt-3 text-xs text-muted-foreground">Sentiment: <span className="text-destructive">Negative</span></p>
            </motion.div>
          </div>
        </div>
      </Section>

      {/* CALL INSIGHTS DEEP DIVE */}
      <Section className="mx-auto max-w-7xl px-6 py-32">
        <div className="grid gap-12 md:grid-cols-2 md:items-center" id="insights">
          <motion.div variants={fadeUp}>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Call insights</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
              Listen to what your sellers are really saying.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Every executive call is transcribed, sentiment-tagged, and mined for issues
              like &ldquo;low buy-leads&rdquo;, &ldquo;PNS not working&rdquo; or &ldquo;competitor offer&rdquo;.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                "Auto-extracted issue tags",
                "Sentiment over time per seller",
                "Verbatim quotes for KAM context",
                "Linked back to the risk score",
              ].map((b, i) => (
                <motion.li key={i} variants={fadeUp} className="flex items-start gap-3 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />{b}
                </motion.li>
              ))}
            </ul>
          </motion.div>

          <motion.div variants={fadeUp} className="relative">
            <div className="space-y-3">
              {[
                { d: "10 May", a: "Vikram Singh", s: "Negative", q: "I'm getting fewer leads than last quarter, thinking of pausing.", t: ["Low BL", "Pricing"] },
                { d: "02 May", a: "Anita Verma", s: "Neutral", q: "PNS calls work but lead quality has dipped.", t: ["PNS quality"] },
                { d: "24 Apr", a: "Rohit Jain", s: "Positive", q: "Catalog upgrade helped, but renewal price feels high.", t: ["Pricing"] },
              ].map((c, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.15 }}
                  className="rounded-2xl border border-border bg-card p-5"
                >
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{c.d} &middot; {c.a}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.s === "Negative" ? "bg-destructive/10 text-destructive"
                      : c.s === "Positive" ? "bg-success/10 text-success"
                      : "bg-muted text-muted-foreground"
                    }`}>{c.s}</span>
                  </div>
                  <p className="mt-3 text-sm italic">&ldquo;{c.q}&rdquo;</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {c.t.map((tag) => (
                      <span key={tag} className="rounded-md bg-muted px-2 py-0.5 text-xs">{tag}</span>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </Section>

      {/* RETENTION GUIDE STRIP */}
      <Section className="bg-foreground py-32 text-background">
        <div className="mx-auto max-w-7xl px-6">
          <motion.div variants={fadeUp} className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-background/60">Retention guide</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
              Don't just see the risk &mdash; act on it.
            </h2>
            <p className="mt-4 text-background/70">
              Every at-risk seller comes with a tailored playbook. KAMs get clear next-best-actions
              instead of a blank page.
            </p>
          </motion.div>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              { i: Zap, t: "Immediate", d: "Schedule a save-call within 48 hours and offer a curated lead pack." },
              { i: Bell, t: "This week", d: "Demo PNS optimisation and audit catalog completeness." },
              { i: Users, t: "Before renewal", d: "Loop in regional manager for a personalised renewal offer." },
            ].map((x, i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                whileHover={{ y: -4 }}
                className="rounded-2xl border border-background/10 bg-background/5 p-6 backdrop-blur"
              >
                <x.i className="h-5 w-5" />
                <h3 className="mt-4 text-lg font-semibold">{x.t}</h3>
                <p className="mt-2 text-sm text-background/70">{x.d}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* FINAL CTA */}
      <Section className="relative overflow-hidden py-32">
        <motion.div
          className="absolute inset-0 -z-10"
          animate={{ backgroundPosition: ["0% 0%", "100% 100%"] }}
          transition={{ duration: 20, repeat: Infinity, repeatType: "reverse" }}
          style={{
            backgroundImage: "radial-gradient(circle at 30% 20%, color-mix(in oklab, var(--destructive) 18%, transparent), transparent 50%), radial-gradient(circle at 70% 80%, color-mix(in oklab, var(--warning) 18%, transparent), transparent 50%)",
            backgroundSize: "200% 200%",
          }}
        />
        <div className="mx-auto max-w-4xl px-6 text-center">
          <motion.h2 variants={fadeUp} className="text-5xl font-semibold tracking-tight md:text-6xl">
            Ready to stop churn before it starts?
          </motion.h2>
          <motion.p variants={fadeUp} className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Open the live dashboard and see your at-risk cohort, ranked and ready to action.
          </motion.p>
          <motion.div variants={fadeUp} className="mt-10">
            <Link to="/" className="inline-flex items-center gap-2 rounded-full bg-foreground px-7 py-3.5 text-sm font-medium text-background hover:opacity-90 transition">
              Open the dashboard <ArrowRight className="h-4 w-4" />
            </Link>
          </motion.div>
        </div>
      </Section>

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 text-xs text-muted-foreground">
          <span>&copy; ChurnGuard for IndiaMART</span>
          <Link to="/" className="hover:text-foreground transition">Dashboard &rarr;</Link>
        </div>
      </footer>
    </div>
  );
}
