// The review panel: instead of one model reading everything at once, a set of
// specialists each read the part of the application they know best, in
// parallel, and a lead reviewer synthesises the verdict from their reports.
//
// This file sequences the run and keeps the UI's view of it. The contract,
// the prompts and the transports live in ./audit/* (docs/spec.md §5): the
// browser sends structured inputs, whoever runs the model builds the prompt,
// and every section is validated before it reaches the page.

import type { Profile } from "../engine";
import { AuditError, directTransport, proxyTransport } from "./audit/client";
import type { Transport } from "./audit/client";
import type {
  AuditInput, AuditProfile, LeadSection, Note as SectionNote, SpecialistId as SectionId,
  SpecialistReportWire, SpecialistSection,
} from "./audit/schema";
import { getApiKey, proxyMode, REVIEW_ENDPOINT } from "./review";
import { supabase } from "./supabase";

const PANEL_STORE = "tcm.panel.v1";

/** A specialist, or "lead" — the stages the UI shows. */
export type SpecialistId = SectionId | "lead";

export interface Specialist {
  id: SectionId;
  name: string;
  role: string;
  color: string;
}

export const SPECIALISTS: Specialist[] = [
  { id: "coursework", name: "Coursework", role: "Major-prep and transcript rigour", color: "var(--blue)" },
  { id: "activities", name: "Activities", role: "What your record shows you actually did", color: "var(--teal)" },
  { id: "essay", name: "Essays", role: "The why-transfer case, line by line", color: "var(--accent)" },
  { id: "fit", name: "School fit", role: "How this file lands at each target", color: "var(--coral)" },
];

export type Note = SectionNote;
export type SpecialistReport = SpecialistReportWire;

export interface PanelResult {
  grade: string;
  summary: string;
  strengths: string[];
  risks: string[];
  reports: SpecialistReport[];
  priorities: string[];
  generatedAt: string;
  /** Specialists that did not deliver, with the reason the student can read.
   *  A partial panel is still shown — paid work is never thrown away — but it
   *  is labelled as partial. */
  failed: { id: SectionId; message: string }[];
  /** Set when the lead synthesis failed; the reports above are still valid. */
  leadError?: string;
}

export interface PanelInput {
  profile: Profile;
  targets: string[];
  whyTransfer: string;
  statement: string;
  activities: string;
}

export function loadPanel(): PanelResult | null {
  try {
    const raw = localStorage.getItem(PANEL_STORE);
    if (!raw) return null;
    const p = JSON.parse(raw) as PanelResult;
    return { ...p, failed: Array.isArray(p.failed) ? p.failed : [] }; // reports cached before `failed` existed
  } catch { return null; }
}

/** The profile fields a review reads — nothing else leaves the browser. */
export function toAuditProfile(p: Profile): AuditProfile {
  return {
    gpa: p.gpa,
    gpaTrend: p.gpaTrend,
    schoolName: p.schoolName,
    institution: p.institution,
    caResident: p.caResident,
    standing: p.standing,
    major: p.major,
    majorDetail: p.majorDetail,
    ptk: p.ptk,
    honors: p.honors,
    igetc: p.igetc,
    firstGen: p.firstGen,
    workHours: p.workHours,
    hook: p.hook,
    courses: p.courses,
    awardsText: p.awardsText,
    transferReason: p.transferReason,
    sat: p.sat,
    ecLevel: p.ecLevel,
    essay: p.essay,
  };
}

async function sessionToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Proxy mode when the deployment holds the key; the user's own key otherwise. */
export function defaultTransport(): Transport {
  return proxyMode
    ? proxyTransport({ endpoint: REVIEW_ENDPOINT, getToken: sessionToken })
    : directTransport(getApiKey);
}

export interface PanelProgress {
  (id: SpecialistId, state: "running" | "done" | "failed", report?: SpecialistReport): void;
}

/** Run the four specialists in parallel, then the lead. One auditId ties the
 *  five calls together for the ledger and the logs. */
export async function runPanel(
  input: PanelInput,
  onProgress?: PanelProgress,
  signal?: AbortSignal,
  transport: Transport = defaultTransport(),
): Promise<PanelResult> {
  const auditId = globalThis.crypto.randomUUID();
  const base: AuditInput = {
    profile: toAuditProfile(input.profile),
    targets: input.targets,
    whyTransfer: input.whyTransfer,
    statement: input.statement,
    activities: input.activities,
  };

  const failures: { id: SectionId; message: string; err: unknown }[] = [];
  const settled = await Promise.all(
    SPECIALISTS.map(async (sp): Promise<SpecialistReport | null> => {
      onProgress?.(sp.id, "running");
      try {
        const section = (await transport.run(
          { schemaVersion: 1, auditId, kind: "specialist", specialist: sp.id, input: base },
          signal,
        )) as SpecialistSection;
        const report: SpecialistReport = { id: sp.id, ...section };
        onProgress?.(sp.id, "done", report);
        return report;
      } catch (err) {
        // One specialist failing must not lose the other three.
        onProgress?.(sp.id, "failed");
        failures.push({ id: sp.id, message: err instanceof Error ? err.message : "This reviewer failed.", err });
        return null;
      }
    }),
  );

  const reports = settled.filter((r): r is SpecialistReport => r !== null);
  if (reports.length === 0) {
    // Every reviewer failed the same way (signed out, no key, service down):
    // say that, not a generic line.
    const first = failures[0]?.err;
    throw first instanceof Error ? first : new Error("Every reviewer failed — try again.");
  }

  // The lead synthesises what arrived. If it fails, the specialist reports —
  // paid for and validated — are still the student's; the result says the
  // verdict is missing instead of throwing them away.
  onProgress?.("lead", "running");
  let lead: LeadSection | null = null;
  let leadError: string | undefined;
  try {
    lead = (await transport.run({ schemaVersion: 1, auditId, kind: "lead", input: base, reports }, signal)) as LeadSection;
    onProgress?.("lead", "done");
  } catch (err) {
    if (err instanceof AuditError && err.code === "aborted") throw err;
    onProgress?.("lead", "failed");
    leadError = err instanceof Error ? err.message : "The lead reviewer failed.";
  }

  const result: PanelResult = {
    grade: lead?.grade ?? "—",
    summary: lead?.summary ?? "",
    strengths: lead?.strengths ?? [],
    risks: lead?.risks ?? [],
    priorities: lead?.priorities ?? [],
    reports,
    generatedAt: new Date().toISOString(),
    failed: failures.map(({ id, message }) => ({ id, message })),
    ...(leadError ? { leadError } : {}),
  };
  try { localStorage.setItem(PANEL_STORE, JSON.stringify(result)); } catch { /* ok */ }
  return result;
}
