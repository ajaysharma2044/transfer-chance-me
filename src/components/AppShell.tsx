// AppShell — the chrome every signed-in route sits inside.
//
// The move this borrows from Linear/Attio: the sidebar is painted in the PAGE
// GROUND colour (--bg-soft) rather than white, so the white content cards to
// its right visibly float above the shell instead of dissolving into it. One
// 1px --line rule separates the two regions; there is no shadow anywhere in
// this file, because borders are how this product separates surfaces.
//
// Integration note for App.tsx: this component owns the <main> landmark. A
// page rendered as {children} must NOT be wrapped in its own <main> — nested
// main elements are invalid and confuse screen readers. Drop the per-view
// <main> wrapper when you move a route inside the shell.
//
// The sidebar sits at top: var(--as-top) (default 0). If the shell is mounted
// under fixed chrome, set --as-top on .as and both the sticky offset and the
// sidebar height follow.

import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { LogoMark, Wordmark } from "./Logo";
import "./appshell.css";

interface NavItem {
  label: string;
  /** Hash route this row navigates to, without the leading "#/". */
  route: string;
  /** Route prefixes that belong to the same section and keep the row lit. */
  family?: string[];
}

const NAV: NavItem[] = [
  // My audit is the whole product: profile, schools, deep review as one flow.
  // The old routes (portal, file, check, results, review) still resolve, but
  // they redirect to #/audit at the right section anchor — so the row keeps
  // lighting up if a bookmark or email link lands the user on one.
  {
    label: "My audit",
    route: "audit",
    family: ["portal", "file", "check", "results", "review"],
  },
  // A single college page is still "Schools" as far as the reader is concerned.
  { label: "Schools", route: "browse", family: ["schools/", "college/"] },
  { label: "Account", route: "account" },
];

/** "#/results/" · "/results" · "results" all normalise to "results". */
function normalise(route: string): string {
  return route.replace(/^#/, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

function isActive(item: NavItem, here: string): boolean {
  if (here === item.route) return true;
  return item.family?.some((p) => here.startsWith(p)) ?? false;
}

export default function AppShell({
  session,
  route,
  go,
  onLogout,
  children,
}: {
  session: { email: string; name: string } | null;
  route: string;
  go: (r: string) => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const here = normalise(route);
  const navRef = useRef<HTMLElement | null>(null);
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  // Below 900px the nav is a horizontally scrolling tab strip, and the active
  // tab can land off-screen after a route change. Centre it — but only when
  // the strip actually overflows, so the desktop column never scrolls.
  useEffect(() => {
    const nav = navRef.current;
    const row = activeRef.current;
    if (!nav || !row) return;
    if (nav.scrollWidth <= nav.clientWidth + 1) return;
    const left = row.offsetLeft - (nav.clientWidth - row.offsetWidth) / 2;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollTo({ left: Math.max(0, left), behavior: reduced ? "auto" : "smooth" });
  }, [here]);

  // Real links, so middle-click, ⌘-click and "copy link address" all behave —
  // but an ordinary click routes through go() rather than the browser.
  function navigate(e: ReactMouseEvent<HTMLAnchorElement>, to: string) {
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(to);
  }

  const name = session?.name.trim() ?? "";
  const email = session?.email.trim() ?? "";

  return (
    <div className="as">
      {/* A fragment href would overwrite the route hash, so the skip control
          is a button that moves focus to the content region directly. */}
      <button
        type="button"
        className="as-skip"
        onClick={() => mainRef.current?.focus()}
      >
        Skip to content
      </button>

      <div className="as-side">
        <a
          className="as-brand"
          href="#/"
          aria-label="Transfer Chance Me home"
          onClick={(e) => navigate(e, "")}
        >
          <LogoMark size={24} />
          <Wordmark />
        </a>

        <nav className="as-nav" aria-label="Sections" ref={navRef}>
          {NAV.map((item) => {
            const active = isActive(item, here);
            return (
              <a
                key={item.route}
                className="as-navrow"
                href={`#/${item.route}`}
                aria-current={active ? "page" : undefined}
                ref={active ? activeRef : undefined}
                onClick={(e) => navigate(e, item.route)}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        <div className="as-foot">
          {session ? (
            <>
              <div className="as-who">
                {name && <span className="as-name">{name}</span>}
                {email && (
                  <span className="as-mail" title={email}>
                    {email}
                  </span>
                )}
              </div>
              <button type="button" className="as-out" onClick={onLogout}>
                Log out
              </button>
            </>
          ) : (
            <a className="as-out" href="#/login" onClick={(e) => navigate(e, "login")}>
              Log in
            </a>
          )}
        </div>
      </div>

      <main className="as-main" ref={mainRef} tabIndex={-1}>
        <div className="as-canvas">{children}</div>
      </main>
    </div>
  );
}
