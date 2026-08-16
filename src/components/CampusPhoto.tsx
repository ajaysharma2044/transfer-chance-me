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
  "USC": "University of Southern California",
  "NYU": "New York University",
  "WashU": "Washington University in St. Louis",
  "UVA": "University of Virginia",
  "Georgia Tech": "Georgia Institute of Technology",
  "UT Austin": "University of Texas at Austin",
  "Tufts": "Tufts University",
  "Boston College": "Boston College",
  "Boston University": "Boston University",
  "Caltech": "California Institute of Technology",
  "Washington": "University of Washington",
  "Wisconsin": "University of Wisconsin–Madison",
};

interface WikiInfo { img: string | null; page: string | null }
const memo = new Map<string, Promise<WikiInfo>>();

const NOT_A_PHOTO = /logo|seal|crest|coat[_ ]of[_ ]arms|wordmark|emblem|shield|banner|icon|map|locator|flag|signature|president|chancellor|provost|professor|dean|founder|police|protest|riot|encampment|rally|\bprint\b|woodcut|front[_ ]view/i;
const LOOKS_LIKE_CAMPUS = /campus|aerial|montage|hall|library|tower|quad|lawn|plaza|chapel|dome|arch|gate|court|walk|green|building|stadium|observatory|garden|square|skyline|panorama|view of/i;

interface MediaItem { type?: string; title?: string; srcset?: { src: string }[] }

const HISTORICAL = /engraving|lithograph|painting|drawing|sketch|portrait|bust|statue|medal|stamp|document|charter|deed|daguerreotype|\bold\b|historic|circa|postcard/i;

/** The postcard shot for each featured campus — targeted by landmark name. */
const ICONIC: Record<string, RegExp> = {
  "Brown": /university hall|main green/i,
  "Carnegie Mellon": /hamerschlag|college of fine arts|gates center/i,
  "Chicago": /rockefeller chapel|harper|hutchinson|main quad/i,
  "Columbia": /low memorial|low library|butler library/i,
  "Cornell": /mcgraw tower|libe slope|arts quad|ho plaza/i,
  "Dartmouth": /baker(-berry)? (memorial )?library|dartmouth green/i,
  "Duke": /duke chapel|\bchapel\b/i,
  "Emory": /quadrangle|candler/i,
  "Georgetown": /healy/i,
  "Harvard": /widener|harvard yard|memorial hall/i,
  "Johns Hopkins": /gilman/i,
  "MIT": /great dome|killian court|maclaurin/i,
  "Michigan": /law quadrangle|the diag|angell hall/i,
  "Northwestern": /deering|weber arch|lakefill/i,
  "Notre Dame": /golden dome|main building|basilica/i,
  "Princeton": /nassau hall|blair arch/i,
  "Rice": /lovett hall|sallyport/i,
  "Stanford": /main quad|memorial church|hoover tower|oval.*panorama/i,
  "UC Berkeley": /sather tower|campanile|sather gate/i,
  "UCLA": /royce hall/i,
  "UNC": /old well/i,
  "UPenn": /college hall|locust walk/i,
  "Vanderbilt": /kirkland/i,
  "Yale": /harkness tower|sterling memorial/i,
  "UC Davis": /shields library|water tower/i,
  "UC Irvine": /aldrich park/i,
  "UC San Diego": /geisel library/i,
  "UC Santa Barbara": /storke tower|campus point/i,
  "UC Santa Cruz": /mchenry library|great meadow/i,
  "UC Riverside": /bell tower|carillon/i,
  "UC Merced": /beginnings|lake yosemite/i,
  "USC": /doheny|bovard|mudd hall/i,
  "NYU": /washington square arch|bobst/i,
  "WashU": /brookings hall/i,
  "UVA": /rotunda|the lawn/i,
  "Georgia Tech": /tech tower|tech green/i,
  "UT Austin": /main building|ut tower|littlefield fountain/i,
  "Tufts": /ballou hall|memorial steps/i,
  "Boston College": /gasson/i,
  "Boston University": /marsh chapel|marsh plaza/i,
  "Caltech": /beckman|millikan|turtle pond/i,
  "Washington": /suzzallo|rainier vista|drumheller/i,
  "Wisconsin": /bascom hall|memorial union/i,
};
const OLD_YEAR = /\b1[5-9]\d{2}\b/; // 1500–1999 in the filename → likely archival

/** Pick a modern campus photograph from the article's media, never a logo. */
function pickPhoto(items: MediaItem[], iconic?: RegExp): string | null {
  // Wikipedia file titles use underscores — normalize before matching
  const norm = (t: string) => t.replace(/_/g, " ");
  const photos = items.filter(
    (m) =>
      m.type === "image" &&
      m.srcset?.length &&
      m.title &&
      !/\.svg$/i.test(m.title) &&
      !NOT_A_PHOTO.test(norm(m.title)),
  );
  if (photos.length === 0) return null;
  const scored = photos.map((m, i) => {
    const t = norm(m.title!);
    let s = 0;
    if (iconic?.test(t)) s += 6;
    if (/montage|aerial|skyline|panorama/i.test(t)) s += 3;
    if (LOOKS_LIKE_CAMPUS.test(t)) s += 2;
    if (/\.jpe?g$/i.test(t)) s += 1;
    if (OLD_YEAR.test(t)) s -= 4;
    if (HISTORICAL.test(t)) s -= 5;
    return { m, s, i };
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  const best = scored[0];
  // Require a positive campus signal — a clean gradient beats a wrong photo.
  if (!best || best.s < 2) return null;
  const src = best.m.srcset![best.m.srcset!.length - 1].src;
  return src.startsWith("//") ? `https:${src}` : src;
}

function lookup(name: string): Promise<WikiInfo> {
  if (!memo.has(name)) {
    const title = (TITLE_OVERRIDES[name] ?? name).replace(/ /g, "_");
    const enc = encodeURIComponent(title);
    memo.set(
      name,
      Promise.all([
        fetch(`https://en.wikipedia.org/api/rest_v1/page/media-list/${enc}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]).then(([media, summary]) => {
        const fromMedia = media?.items ? pickPhoto(media.items as MediaItem[], ICONIC[name]) : null;
        // The lead image is a fallback only if it isn't logo-shaped
        const lead: string | null = summary?.originalimage?.source ?? null;
        const leadOk = lead && !NOT_A_PHOTO.test(lead) && !/\.svg/i.test(lead);
        return {
          img: fromMedia ?? (leadOk ? lead : null),
          page: summary?.content_urls?.desktop?.page ?? null,
        };
      }),
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
