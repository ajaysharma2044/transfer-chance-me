import { MODEL } from "../engine";
import Tile from "./Tile";

// Per-college page. Filled out in detail by the school-pages workstream.

interface Props {
  name: string;
  onBack: () => void;
  onStart: () => void;
  onOpenSchool: (name: string) => void;
}

export default function SchoolPage({ name, onBack, onStart }: Props) {
  const s = MODEL.schools.find((x) => x.name === name);
  if (!s) return <div className="shell"><p>School not found.</p><button className="btn-quiet" onClick={onBack}>← Back</button></div>;
  return (
    <div className="shell">
      <button type="button" className="btn-quiet" onClick={onBack}>← Back</button>
      <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}><Tile name={s.name} size={40} /> {s.name}</h1>
      <p>Official transfer admit rate: {s.rate.toFixed(1)}%</p>
      <button type="button" className="btn" onClick={onStart}>Check my chances</button>
    </div>
  );
}
