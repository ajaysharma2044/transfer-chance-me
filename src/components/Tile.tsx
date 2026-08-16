import { useState } from "react";
import { logoUrl, markOf } from "../lib/schools";

// School mark with a single, uniform chrome: white rounded tile, hairline
// border, soft shadow — whether the school's own favicon loads or we fall
// back to its monogram in the school color. Keeps every logo in sync.

export default function Tile({ name, size = 30 }: { name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const mark = markOf(name);
  const inner = Math.round(size * 0.72);
  return (
    <span className="tile tile-sync" style={{ width: size, height: size }} aria-hidden="true">
      {failed ? (
        <span
          className="tile-mono"
          style={{ color: mark.color, fontSize: Math.max(9, Math.round(size * 0.34)) }}
        >
          {mark.mono}
        </span>
      ) : (
        <img
          style={{ width: inner, height: inner }}
          src={logoUrl(name)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
