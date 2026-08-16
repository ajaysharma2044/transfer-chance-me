// Pricing page. Filled out by the auth/pricing workstream.

export default function Pricing({ onStart }: { onStart: () => void }) {
  return (
    <div className="shell">
      <h1>Pricing</h1>
      <button type="button" className="btn" onClick={onStart}>Start free</button>
    </div>
  );
}
