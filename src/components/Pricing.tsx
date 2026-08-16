import { useState } from "react";
import type { FormEvent } from "react";
import "./auth.css";

const WAITLIST_KEY = "tcm.waitlist.v1";

interface WaitlistEntry {
  email: string;
  tier: string;
  at: string;
}

function loadWaitlist(): WaitlistEntry[] {
  try {
    const raw = localStorage.getItem(WAITLIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as WaitlistEntry[]) : [];
  } catch {
    return [];
  }
}

function joinWaitlist(email: string, tier: string): void {
  const list = loadWaitlist();
  const em = email.trim().toLowerCase();
  if (!list.some((e) => e.email === em && e.tier === tier)) {
    list.push({ email: em, tier, at: new Date().toISOString() });
  }
  localStorage.setItem(WAITLIST_KEY, JSON.stringify(list));
}

function Waitlist({ tier }: { tier: string }) {
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const em = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(em)) {
      setError("That doesn't look like an email address.");
      return;
    }
    setError(null);
    joinWaitlist(em, tier);
    setJoined(true);
  }

  if (joined) {
    return (
      <p className="pr-thanks" role="status">
        You're on the list — we'll email you when {tier} launches.
      </p>
    );
  }

  return (
    <form className="pr-waitlist" onSubmit={submit} noValidate>
      <label className="pr-wl-label" htmlFor={`pr-wl-${tier}`}>
        Join the waitlist
      </label>
      <div className="pr-wl-row">
        <input
          id={`pr-wl-${tier}`}
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className="pr-wl-btn">
          Notify me
        </button>
      </div>
      {error && (
        <p className="pr-wl-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export default function Pricing({ onStart }: { onStart: () => void }) {
  return (
    <div className="pr-wrap">
      <header className="pr-head">
        <h1>Simple, honest pricing</h1>
        <p className="pr-dek">
          Everything the tool does today is free. Paid tiers are on the way — join a
          waitlist and we'll tell you when they exist, not before.
        </p>
      </header>

      <div className="pr-grid">
        {/* Free */}
        <section className="pr-card" aria-label="Free plan">
          <div className="pr-tier">Free</div>
          <div className="pr-price">
            $0 <span className="pr-per">forever</span>
          </div>
          <p className="pr-sum">Everything that exists today.</p>
          <ul className="pr-feats">
            <li>Chances at all 24 schools</li>
            <li>Application upload &amp; parsing</li>
            <li>Essay check</li>
            <li>Printable report</li>
          </ul>
          <button type="button" className="btn pr-cta" onClick={onStart}>
            Start free
          </button>
        </section>

        {/* Plus */}
        <section className="pr-card pr-popular" aria-label="Plus plan, coming soon">
          <span className="pr-chip">Most popular</span>
          <div className="pr-tier">
            Plus <span className="pr-soon">Coming soon</span>
          </div>
          <div className="pr-price">
            $9 <span className="pr-per">/ month</span>
          </div>
          <p className="pr-sum">For applicants who want to iterate.</p>
          <ul className="pr-feats">
            <li>Saved profiles across devices</li>
            <li>Multiple essay versions</li>
            <li>Deeper reports</li>
          </ul>
          <Waitlist tier="Plus" />
        </section>

        {/* Counselor */}
        <section className="pr-card" aria-label="Counselor plan, coming soon">
          <div className="pr-tier">
            Counselor <span className="pr-soon">Coming soon</span>
          </div>
          <div className="pr-price">
            $49 <span className="pr-per">/ month</span>
          </div>
          <p className="pr-sum">For advisors working with a caseload.</p>
          <ul className="pr-feats">
            <li>Manage multiple students</li>
            <li>Batch reports</li>
            <li>Export</li>
          </ul>
          <Waitlist tier="Counselor" />
        </section>
      </div>

      <p className="pr-foot">
        No payments are taken today. Waitlist emails are stored on this device only
        during the beta.
      </p>
    </div>
  );
}
