import type { School } from "../engine";

// The school's observed admitted-GPA distribution as a quiet inline scale:
// p10–p90 whisker, p25–p75 emphasis, median notch, and the applicant's GPA
// as a green marker. Shared 3.40–4.00 domain so rows compare down the table.

const LO = 3.4;
const HI = 4.005;

function x(g: number): number {
  const c = Math.min(HI, Math.max(LO, g));
  return ((c - LO) / (HI - LO)) * 100;
}

export default function GpaStrip({ school, gpa }: { school: School; gpa: number }) {
  const { p10, p25, p50, p75, p90 } = school.gpa;
  if (p50 == null) {
    return <div className="strip" style={{ fontSize: 12, color: "var(--ink-3)" }}>GPA range not published</div>;
  }
  const below = gpa < LO;
  const ux = x(gpa);
  return (
    <div className="strip" aria-label={`Admitted GPA at ${school.name}: 25th percentile ${p25}, median ${p50}, 75th percentile ${p75}. Your GPA ${gpa.toFixed(2)}.`}>
      <svg viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="22" x2="100" y2="22" stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {p10 != null && p90 != null && (
          <line x1={x(p10)} y1="22" x2={x(p90)} y2="22" stroke="var(--line-strong)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        )}
        {p25 != null && p75 != null && (
          <line className="strip-draw" pathLength={1} x1={x(p25)} y1="22" x2={x(p75)} y2="22" stroke="#a99ee8" strokeWidth="4" vectorEffect="non-scaling-stroke" />
        )}
        <line x1={x(p50)} y1="16" x2={x(p50)} y2="28" stroke="var(--ink)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <line className="strip-marker" x1={ux} y1="8" x2={ux} y2="30" stroke="var(--teal)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ position: "relative", height: 12, marginTop: -4 }}>
        <span style={lab(x(p50), "var(--ink-3)")}>{p50.toFixed(2)}</span>
        <span style={{ ...lab(ux, "var(--teal)"), top: -38, fontWeight: 600 }}>
          {below ? "‹" : ""}{gpa.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function lab(px: number, color: string): React.CSSProperties {
  return {
    position: "absolute",
    left: `${px}%`,
    transform: px > 88 ? "translateX(-100%)" : px < 12 ? "none" : "translateX(-50%)",
    fontSize: 10.5,
    fontVariantNumeric: "tabular-nums",
    color,
    top: 0,
    whiteSpace: "nowrap",
  };
}
