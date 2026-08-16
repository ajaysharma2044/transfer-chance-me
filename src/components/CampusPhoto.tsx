import { useEffect, useState } from "react";

// Campus photo banner: the school's Wikipedia lead image (openly licensed,
// credited) with a school-color gradient fallback when none exists.

const TITLE_OVERRIDES: Record<string, string> = {
  "Brown": "Brown University",
  "Carnegie Mellon": "Carnegie Mellon University",
  "Chicago": "University of Chicago",
  "Columbia": "Columbia University",
  "Cornell": "Cornell University",
  "Dartmouth": "Dartmouth College",
  "Duke": "Duke University",
  "Emory": "Emory University",
  "Georgetown": "Georgetown University",
  "Harvard": "Harvard University",
  "Johns Hopkins": "Johns Hopkins University",
  "MIT": "Massachusetts Institute of Technology",
  "Michigan": "University of Michigan",
  "Northwestern": "Northwestern University",
  "Notre Dame": "University of Notre Dame",
  "Princeton": "Princeton University",
  "Rice": "Rice University",
  "Stanford": "Stanford University",
  "UC Berkeley": "University of California, Berkeley",
  "UCLA": "University of California, Los Angeles",
  "UNC": "University of North Carolina at Chapel Hill",
  "UPenn": "University of Pennsylvania",
  "Vanderbilt": "Vanderbilt University",
  "Yale": "Yale University",
  "UC Davis": "University of California, Davis",
  "UC Irvine": "University of California, Irvine",
  "UC San Diego": "University of California, San Diego",
  "UC Santa Barbara": "University of California, Santa Barbara",
  "UC Santa Cruz": "University of California, Santa Cruz",
  "UC Riverside": "University of California, Riverside",
  "UC Merced": "University of California, Merced",
};

interface WikiInfo { img: string | null; page: string | null }
const memo = new Map<string, Promise<WikiInfo>>();

function lookup(name: string): Promise<WikiInfo> {
  if (!memo.has(name)) {
    const title = (TITLE_OVERRIDES[name] ?? name).replace(/ /g, "_");
    memo.set(
      name,
      fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => ({
          img: d?.originalimage?.source ?? d?.thumbnail?.source ?? null,
          page: d?.content_urls?.desktop?.page ?? null,
        }))
        .catch(() => ({ img: null, page: null })),
    );
  }
  return memo.get(name)!;
}

export default function CampusPhoto({
  name, color = "#14183f", height = 220,
}: { name: string; color?: string; height?: number }) {
  const [info, setInfo] = useState<WikiInfo | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let live = true;
    setInfo(null);
    setBroken(false);
    lookup(name).then((i) => { if (live) setInfo(i); });
    return () => { live = false; };
  }, [name]);

  const showImg = info?.img && !broken;
  return (
    <figure className="campus" style={{ height }}>
      {showImg ? (
        <img src={info!.img!} alt={`${name} campus`} onError={() => setBroken(true)} />
      ) : (
        <div
          className="campus-fallback"
          style={{ background: `linear-gradient(120deg, ${color}, ${color}cc 55%, #6c4be0aa)` }}
          aria-hidden="true"
        />
      )}
      {showImg && info?.page && (
        <figcaption>
          <a href={info.page} target="_blank" rel="noreferrer">Photo · Wikipedia</a>
        </figcaption>
      )}
    </figure>
  );
}
