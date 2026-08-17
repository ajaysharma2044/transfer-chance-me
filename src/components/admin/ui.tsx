// Small shared pieces for the admin console.
//
// Two of these carry most of the weight of "tell the truth on screen":
//
//   ErrorNote  — names the failure and then prints the server's own sentence.
//                api/_admin.ts answers with real, specific messages ("Multi-
//                factor authentication is required for staff accounts.",
//                "Confirm your password again to continue."), and an operator
//                who is shown "Something went wrong" instead cannot act on it.
//   EmptyState — says what is empty and why it is empty, never a bare "None".

import type { ReactNode } from "react";
import { AdminApiError } from "./api";

export function Loading({ label }: { label: string }) {
  return (
    <p className="ad-loading" role="status">
      <span className="ad-dot" aria-hidden="true" />
      {label}
    </p>
  );
}

const TITLES: Record<string, string> = {
  "no-backend": "No backend configured",
  "signed-out": "You are signed out",
  unreachable: "The admin API did not answer",
  "not-found": "Not found",
  unauthorized: "Sign in again to continue",
  forbidden: "The server refused this request",
  "rate-limited": "Too many requests",
  server: "The admin API returned an error",
};

export function ErrorNote({
  error,
  onRetry,
  what,
}: {
  error: AdminApiError | Error;
  onRetry?: () => void;
  /** What was being attempted, e.g. "loading the case list". */
  what?: string;
}) {
  const api = error instanceof AdminApiError ? error : null;
  const title = api ? (TITLES[api.kind] ?? TITLES.server) : "Something went wrong";
  return (
    <div className="ad-error" role="alert">
      <p className="ad-error-title">
        {title}
        {api && api.status > 0 && <span className="ad-error-code num"> · HTTP {api.status}</span>}
      </p>
      {what && <p className="ad-error-what">While {what}.</p>}
      {/* The server's exact words. Rendered as text, never as markup. */}
      <p className="ad-error-msg">{error.message}</p>
      <div className="ad-error-acts">
        {onRetry && (
          <button type="button" className="ad-btn" onClick={onRetry}>
            Try again
          </button>
        )}
        {api?.kind === "signed-out" || api?.kind === "unauthorized" ? (
          <a className="ad-btn" href="#/login">
            Go to sign-in
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="ad-empty">
      <p className="ad-empty-title">{title}</p>
      {children && <p className="ad-empty-why">{children}</p>}
    </div>
  );
}

export function Panel({
  title,
  note,
  actions,
  children,
}: {
  title: string;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ad-panel">
      <div className="ad-panel-head">
        <div>
          <h2>{title}</h2>
          {note && <p className="ad-panel-note">{note}</p>}
        </div>
        {actions && <div className="ad-panel-acts">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A definition row. `value` is already-cleaned text; never markup. */
export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="ad-kv-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function Pager({
  page,
  total,
  perPage,
  busy,
  onPage,
}: {
  page: number;
  total: number;
  perPage: number;
  busy?: boolean;
  onPage: (p: number) => void;
}) {
  const first = total === 0 ? 0 : page * perPage + 1;
  const last = Math.min(total, (page + 1) * perPage);
  const hasNext = last < total;
  return (
    <div className="ad-pager">
      <span className="ad-pager-count num">
        {total === 0 ? "0 rows" : `${first}–${last} of ${total}`}
      </span>
      <div className="ad-pager-acts">
        <button
          type="button"
          className="ad-btn"
          disabled={page === 0 || busy}
          onClick={() => onPage(page - 1)}
        >
          ← Previous
        </button>
        <button
          type="button"
          className="ad-btn"
          disabled={!hasNext || busy}
          onClick={() => onPage(page + 1)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
