// The full US institution directory (public/schools.json, IPEDS-derived),
// lazily loaded and cached. Powers search and per-school profile pages.

export interface DirSchool {
  idx: number;
  name: string;
  state: string;
  kind: "cc" | "public4" | "private4";
  domain: string;
  city: string;
  sizeCat: number;          // IPEDS INSTSIZE 1-5; 0 unknown
  admitRate: number | null; // freshman admit rate % (IPEDS ADM); null = not reported
}

export const KIND_LABEL: Record<DirSchool["kind"], string> = {
  cc: "Community college",
  public4: "4-year public",
  private4: "4-year private",
};

export const SIZE_LABEL: Record<number, string> = {
  0: "",
  1: "Under 1,000 students",
  2: "1,000–4,999 students",
  3: "5,000–9,999 students",
  4: "10,000–19,999 students",
  5: "20,000+ students",
};

type Row = [string, string, DirSchool["kind"], string, string, number, number | null];

let cache: DirSchool[] | null = null;

export async function loadDirectory(): Promise<DirSchool[]> {
  if (!cache) {
    const res = await fetch("/schools.json");
    const rows = (await res.json()) as Row[];
    cache = rows.map((r, idx) => ({
      idx,
      name: r[0], state: r[1], kind: r[2], domain: r[3],
      city: r[4] ?? "", sizeCat: r[5] ?? 0, admitRate: r[6] ?? null,
    }));
  }
  return cache;
}

export function searchDirectory(all: DirSchool[], q: string, limit = 12): DirSchool[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const starts = all.filter((s) => s.name.toLowerCase().startsWith(needle));
  const contains = all.filter(
    (s) => !s.name.toLowerCase().startsWith(needle) && s.name.toLowerCase().includes(needle),
  );
  return [...starts, ...contains].slice(0, limit);
}
