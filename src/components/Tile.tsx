import { useState } from "react";
import { logoUrl, markOf } from "../lib/schools";

// School mark: the school's own favicon (loaded live from its domain via
// Google's favicon service), falling back to our color monogram tile.

export default function Tile({ name, size = 30 }: { name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const mark = markOf(name);
  if (failed) {
    return (
      <span className="tile" style={{ background: mark.color, width: size, height: size }} aria-hidden="true">
        {mark.mono}
      </span>
    );
  }
  return (
    <img
      className="tile tile-img"
      style={{ width: size, height: size }}
      src={logoUrl(name)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
