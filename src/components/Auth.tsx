import type { Session } from "../lib/auth";

// Login / signup page. Filled out by the auth/pricing workstream.

export default function Auth({ onDone }: { onDone: (s: Session) => void }) {
  return (
    <div className="shell">
      <h1>Log in</h1>
      <button type="button" className="btn" onClick={() => onDone({ email: "", name: "" })}>Continue</button>
    </div>
  );
}
