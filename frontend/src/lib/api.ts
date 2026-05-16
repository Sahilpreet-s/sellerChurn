import type { Seller, CallInsight } from "./mock-sellers";

// Server-side (SSR): use absolute URL directly. Browser: use relative path so
// Vite's /api proxy forwards the request and avoids cross-origin (CORS) errors.
const BASE =
  typeof window === "undefined"
    ? ((import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8080/api/v1")
    : "/api/v1";

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  // new URL() requires an absolute URL; in the browser supply origin as base so relative paths work
  const origin = typeof window !== "undefined" ? window.location.origin : undefined;
  const url = new URL(BASE + path, origin);
  if (params) Object.entries(params).forEach(([k, v]) => v && url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
  return r.json();
}

// ─── Seller endpoints ─────────────────────────────────────────────────────────

export type SellerListParams = {
  risk?: string;
  status?: string;
  package?: string;
  q?: string;
};

export function fetchSellers(params?: SellerListParams): Promise<Seller[]> {
  return get<Seller[]>("/sellers", params as Record<string, string>);
}

export function fetchSeller(id: string): Promise<Seller> {
  return get<Seller>(`/sellers/${id}`);
}

// ─── Stats & patterns ─────────────────────────────────────────────────────────

export type DashboardStats = {
  total: number;
  high: number;
  medium: number;
  low: number;
  arrAtRisk: number;
  cohortDate: string;
};

export function fetchStats(): Promise<DashboardStats> {
  return get<DashboardStats>("/stats");
}

export type PatternAlert = {
  id: string;
  type: "PLATFORM" | "SEASONAL" | "LEAD_FIT";
  severity: "High" | "Medium";
  title: string;
  narrative: string;
  affectedIds: string[];
  affectedCount: number;
};

export function fetchPatterns(): Promise<PatternAlert[]> {
  return get<PatternAlert[]>("/patterns");
}

// ─── Outcome logging ──────────────────────────────────────────────────────────

export type OutcomeResult = {
  record: { id: number; sellerId: string; outcome: string; loggedAt: string };
  totalOutcomes: number;
  nextRetrainAt: number;
  message: string;
};

export type OutcomeBody = {
  outcome: string;
  notes?: string;
  disposition?: string;
  churnReasons?: string[];
  competitorMentioned?: string;
  execCommitment?: string;
  followUpDate?: string;
  customReason?: string;
};

export function logOutcome(sellerId: string, body: OutcomeBody): Promise<OutcomeResult> {
  return post<OutcomeResult>(`/sellers/${sellerId}/outcome`, body);
}

// ─── Playbook ─────────────────────────────────────────────────────────────────

export type PlaybookEntry = {
  archetype: string;
  sampleSize: number;
  retentionRate: number;
  winningApproaches: string[];
  failedApproaches: string[];
  keyInsight: string;
  doNotDo: string[];
  updatedAt: string;
};

export function fetchPlaybook(): Promise<PlaybookEntry[]> {
  return get<PlaybookEntry[]>("/playbook");
}

// ─── Audio pipeline ───────────────────────────────────────────────────────────

export function uploadAudio(file: File, sellerId: string, agent: string): Promise<CallInsight> {
  const form = new FormData();
  form.append("file", file);
  form.append("sellerId", sellerId);
  form.append("agent", agent);
  return fetch(`${BASE}/audio/upload`, { method: "POST", body: form })
    .then(r => { if (!r.ok) throw new Error(`upload → ${r.status}`); return r.json(); });
}

// ─── MERP note extraction ─────────────────────────────────────────────────────

export function extractMerpNote(rawNote: string, sellerId: string, agent: string): Promise<CallInsight> {
  return post<CallInsight>("/merp/extract", { rawNote, sellerId, agent });
}

// ─── ML service ───────────────────────────────────────────────────────────────

export type MLPrediction = {
  sellerId: string;
  churnProb: number;
  topFeatures: string[];
  modelVersion: string;
};

export type MLStats = {
  trainingExamples: number;
  auc: number;
  nextRetrainAt: number;
  lastTrainedAt: string | null;
  modelActive: boolean;
  topFeatures?: string[];
  featureImportances?: Record<string, number>;
};

export function fetchMLPrediction(sellerId: string): Promise<MLPrediction> {
  return get<MLPrediction>(`/ml/prediction/${sellerId}`);
}

export function fetchMLStats(): Promise<MLStats> {
  return get<MLStats>("/ml/stats");
}

export function triggerRetraining(): Promise<{ auc: number; previousAuc: number; swapped: boolean; trainingExamples: number }> {
  return post("/ml/train");
}
