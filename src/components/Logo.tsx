// Inline recreation of the Transfer Chance Me mark: gradient C, teal rising
// arrow, coral spark. Swap for the real asset by dropping logo.png in public/.

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="tcm-c" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2478e5" />
          <stop offset="1" stopColor="#6c4be0" />
        </linearGradient>
      </defs>
      <path d="M39 12.5 A19 19 0 1 0 39 35.5" stroke="url(#tcm-c)" strokeWidth="8" strokeLinecap="round" />
      <path d="M17 33 L33 17" stroke="#14b8a0" strokeWidth="6.5" strokeLinecap="round" />
      <path d="M23.5 13.5 h11 v11 z" fill="#14b8a0" />
      <path d="M40 2.5 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 z" fill="#ee6352" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="brandword">
      <span style={{ color: "var(--ink)" }}>Transfer</span>{" "}
      <span style={{ color: "var(--accent)" }}>Chance</span>{" "}
      <span style={{ color: "var(--teal)" }}>Me</span>
    </span>
  );
}
