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
  "Northeastern": "Northeastern University",
  "Purdue": "Purdue University",
  "Ohio State": "Ohio State University",
  "Penn State": "Pennsylvania State University",
  "Maryland": "University of Maryland, College Park",
  "Illinois": "University of Illinois Urbana-Champaign",
  "Florida": "University of Florida",
  "Texas A&M": "Texas A&M University",
  "San Diego State": "San Diego State University",
  "Cal Poly SLO": "California Polytechnic State University",
  "San Jose State": "San José State University",
  "Cal State Long Beach": "California State University, Long Beach",
  "Cal State Fullerton": "California State University, Fullerton",
  "Santa Clara": "Santa Clara University",
  "Fordham": "Fordham University",
  "Villanova": "Villanova University",
  "Tulane": "Tulane University",
  "Wake Forest": "Wake Forest University",
  "William & Mary": "College of William & Mary",
  "Case Western": "Case Western Reserve University",
  "Rochester": "University of Rochester",
  "Brandeis": "Brandeis University",
  "UMass Amherst": "University of Massachusetts Amherst",
  "Rutgers": "Rutgers University",
  "Pitt": "University of Pittsburgh",
  "Indiana": "Indiana University Bloomington",
  "Arizona State": "Arizona State University",
  "Colorado Boulder": "University of Colorado Boulder",
  "Spelman": "Spelman College",
  "Stony Brook": "Stony Brook University",
  "Binghamton": "Binghamton University",
  "Stevens": "Stevens Institute of Technology",
  "Drexel": "Drexel University",
  "GWU": "George Washington University",
  "RPI": "Rensselaer Polytechnic Institute",
  "Colorado State": "Colorado State University",
  "Buffalo": "University at Buffalo",
  "Marquette": "Marquette University",
  "CSU Northridge": "California State University, Northridge",
  "Temple": "Temple University",
  "Howard": "Howard University",
  "SMU": "Southern Methodist University",
  "TCU": "Texas Christian University",
  "Oregon State": "Oregon State University",
  "Cal State San Marcos": "California State University San Marcos",
  "Baylor": "Baylor University",
  "American": "American University",
  "Sacramento State": "California State University, Sacramento",
  "Lehigh": "Lehigh University",
  "NC State": "North Carolina State University",
  "Alabama": "University of Alabama",
  "Nebraska": "University of Nebraska–Lincoln",
  "Minnesota Twin Cities": "University of Minnesota",
  "Pepperdine": "Pepperdine University",
  "Loyola Marymount": "Loyola Marymount University",
  "Delaware": "University of Delaware",
  "Oklahoma": "University of Oklahoma",
  "Clemson": "Clemson University",
  "Auburn": "Auburn University",
  "Georgia": "University of Georgia",
  "Arizona": "University of Arizona",
  "South Carolina": "University of South Carolina",
  "UConn": "University of Connecticut",
  "Oregon": "University of Oregon",
  "Iowa": "University of Iowa",
  "Washington State": "Washington State University",
  "Michigan State": "Michigan State University",
  "Iowa State": "Iowa State University",
  "Kansas": "University of Kansas",
  "Utah": "University of Utah",
  "Tennessee": "University of Tennessee",
  "Cal Poly Pomona": "California State Polytechnic University, Pomona",
  "Chico State": "California State University, Chico",
  "Queens College (CUNY)": "Queens College, City University of New York",
  "Syracuse": "Syracuse University",
  "City College (CUNY)": "City College of New York",
  "Virginia Tech": "Virginia Tech",
  "Baruch": "Baruch College",
  "Sonoma State": "Sonoma State University",
  "SUNY Albany": "University at Albany, SUNY",
  "Mizzou": "University of Missouri",
  "SUNY Geneseo": "State University of New York at Geneseo",
  "James Madison": "James Madison University",
  "SF State": "San Francisco State University",
  "Rowan": "Rowan University",
  "Montclair State": "Montclair State University",
  "CSU Channel Islands": "California State University Channel Islands",
  "George Mason": "George Mason University",
  "Cal State San Bernardino": "California State University, San Bernardino",
  "Cal Poly Humboldt": "Cal Poly Humboldt",
  "Cal State LA": "California State University, Los Angeles",
  "Cal State Dominguez Hills": "California State University, Dominguez Hills",
  "CSU Monterey Bay": "California State University, Monterey Bay",
  "Amherst": "Amherst College",
  "Williams": "Williams College",
  "Swarthmore": "Swarthmore College",
  "Pomona College": "Pomona College",
  "Claremont McKenna": "Claremont McKenna College",
  "Harvey Mudd": "Harvey Mudd College",
  "Wesleyan": "Wesleyan University",
  "Middlebury": "Middlebury College",
  "Bowdoin": "Bowdoin College",
  "Bates": "Bates College",
  "Hamilton College": "Hamilton College (New York)",
  "Vassar": "Vassar College",
  "Barnard": "Barnard College",
  "Colgate": "Colgate University",
  "Bucknell": "Bucknell University",
  "Richmond": "University of Richmond",
  "Davidson": "Davidson College",
  "Washington and Lee": "Washington and Lee University",
  "Grinnell": "Grinnell College",
  "Carleton": "Carleton College",
  "Macalester": "Macalester College",
  "Oberlin": "Oberlin College",
  "Kenyon": "Kenyon College",
  "Smith": "Smith College",
  "Mount Holyoke": "Mount Holyoke College",
  "Occidental": "Occidental College",
  "Scripps": "Scripps College",
  "Fairfield University": "Fairfield University",
  "Rhodes College": "Rhodes College",
  "Denison University": "Denison University",
  "Furman University": "Furman University",
  "Trinity College (Connecticut)": "Trinity College (Connecticut)",
  "Union College": "Union College (New York)",
  "Skidmore College": "Skidmore College",
  "Loyola University Maryland": "Loyola University Maryland",
  "Loyola Chicago": "Loyola University Chicago",
  "University of San Francisco": "University of San Francisco",
  "Elon University": "Elon University",
  "Providence College": "Providence College",
  "DePaul": "DePaul University",
  "University of San Diego": "University of San Diego",
  "University of Denver": "University of Denver",
  "Cal State Bakersfield": "California State University, Bakersfield",
  "Xavier University": "Xavier University (Ohio)",
  "Creighton": "Creighton University",
  "VCU": "Virginia Commonwealth University",
  "Old Dominion": "Old Dominion University",
  "Towson": "Towson University",
  "Kennesaw State": "Kennesaw State University",
  "Georgia State": "Georgia State University",
  "University of North Texas": "University of North Texas",
  "Texas Tech": "Texas Tech University",
  "Texas State": "Texas State University",
  "University of Houston": "University of Houston",
  "University of Texas at Dallas": "University of Texas at Dallas",
  "Miami University (Ohio)": "Miami University",
  "Bowling Green State University": "Bowling Green State University",
  "Kent State": "Kent State University",
  "Cleveland State": "Cleveland State University",
  "West Virginia University": "West Virginia University",
  "Louisville": "University of Louisville",
  "Kentucky": "University of Kentucky",
  "Cincinnati": "University of Cincinnati",
  "UNC Charlotte": "University of North Carolina at Charlotte",
  "East Carolina": "East Carolina University",
  "Appalachian State": "Appalachian State University",
  "Mississippi State": "Mississippi State University",
  "Ole Miss": "University of Mississippi",
  "Louisiana State": "Louisiana State University",
  "Arkansas": "University of Arkansas",
  "New Mexico": "University of New Mexico",
  "Nevada Las Vegas": "University of Nevada, Las Vegas",
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
  "Northeastern": /snell library|centennial common|krentzman/i,
  "Purdue": /engineering fountain|hovde|bell tower/i,
  "Ohio State": /thompson library|oval|university hall/i,
  "Penn State": /old main/i,
  "Maryland": /mckeldin|testudo|main administration/i,
  "Illinois": /alma mater|foellinger|main quad/i,
  "Florida": /century tower|plaza of the americas/i,
  "Texas A&M": /academic building|century tree/i,
  "San Diego State": /hepner hall/i,
  "Cal Poly SLO": /performing arts|campus/i,
  "San Jose State": /tower hall|.*campus/i,
  "Cal State Long Beach": /walter pyramid|university library/i,
  "Cal State Fullerton": /langsdorf hall/i,
  "Santa Clara": /mission santa clara|de saisset/i,
  "Fordham": /keating hall|rose hill/i,
  "Villanova": /st\. thomas of villanova|church/i,
  "Tulane": /gibson hall/i,
  "Wake Forest": /wait chapel|reynolda/i,
  "William & Mary": /wren building|sunken garden/i,
  "Case Western": /adelbert|tinkham veale|kelvin smith/i,
  "Rochester": /rush rhees/i,
  "Brandeis": /usen castle|shapiro/i,
  "UMass Amherst": /old chapel|w\.e\.b\. du bois library/i,
  "Rutgers": /old queens|voorhees mall/i,
  "Pitt": /cathedral of learning/i,
  "Indiana": /sample gates|showalter fountain/i,
  "Arizona State": /old main|hayden library/i,
  "Colorado Boulder": /norlin|flatirons/i,
  "Spelman": /rockefeller hall|sisters chapel/i,
  "Stony Brook": /administration|melville library/i,
  "Binghamton": /peace quad|bartle library/i,
  "Stevens": /howe center|castle point/i,
  "Drexel": /main building|korman/i,
  "GWU": /lisner|kogan plaza|university yard/i,
  "RPI": /west hall|emma willard|folsom/i,
  "Colorado State": /oval|administration building/i,
  "Buffalo": /hayes hall|baird point/i,
  "Marquette": /st\. joan of arc|marquette hall/i,
  "CSU Northridge": /oviatt library/i,
  "Temple": /bell tower|sullivan hall|charles library/i,
  "Howard": /founders library|the yard/i,
  "SMU": /dallas hall/i,
  "TCU": /frog fountain|sadler hall/i,
  "Oregon State": /memorial union|weatherford/i,
  "Cal State San Marcos": /kellogg library|campus/i,
  "Baylor": /pat neff|burleson quadrangle/i,
  "American": /kay spiritual|mcKinley|quad/i,
  "Sacramento State": /library|guy west bridge/i,
  "Lehigh": /university center|packer|linderman/i,
  "NC State": /memorial belltower|holladay hall/i,
  "Alabama": /denny chimes|gorgas library/i,
  "Nebraska": /love library|memorial stadium/i,
  "Minnesota Twin Cities": /northrop|coffman|mall/i,
  "Pepperdine": /theme tower|phillips|malibu/i,
  "Loyola Marymount": /sacred heart chapel|university hall/i,
  "Delaware": /memorial hall|the green/i,
  "Oklahoma": /bizzell memorial library|gaylord/i,
  "Clemson": /tillman hall|carillon/i,
  "Auburn": /samford hall/i,
  "Georgia": /the arch|academic building/i,
  "Arizona": /old main|university of arizona campus/i,
  "South Carolina": /horseshoe|mccutchen/i,
  "UConn": /wilbur cross|student union/i,
  "Oregon": /deady|knight library|memorial quad/i,
  "Iowa": /old capitol|pentacrest/i,
  "Washington State": /bryan hall|thompson hall/i,
  "Michigan State": /beaumont tower|sparty/i,
  "Iowa State": /campanile|central campus|beardshear/i,
  "Kansas": /fraser hall|campanile|strong hall/i,
  "Utah": /park building|block u/i,
  "Tennessee": /ayres hall/i,
  "Cal Poly Pomona": /campus|kellogg/i,
  "Chico State": /kendall hall|trinity/i,
  "Queens College (CUNY)": /jefferson hall|library/i,
  "Syracuse": /crouse college|hall of languages/i,
  "City College (CUNY)": /shepard hall|gothic/i,
  "Virginia Tech": /burruss hall|drillfield/i,
  "Baruch": /vertical campus|newman hall/i,
  "Sonoma state": /green music|campus/i,
  "SUNY Albany": /academic podium|dutch quad/i,
  "Mizzou": /jesse hall|columns/i,
  "SUNY Geneseo": /erwin hall|college green/i,
  "James Madison": /wilson hall|quad/i,
  "SF State": /administration|hensill/i,
  "Rowan": /bunce hall|james hall/i,
  "Montclair State": /college hall|red hawk/i,
  "CSU Channel Islands": /library|campus/i,
  "George Mason": /fairfax|quad/i,
  "Cal State San Bernardino": /pfau library|campus/i,
  "Cal Poly Humboldt": /founders hall|redwood/i,
  "Cal State LA": /library|campus/i,
  "Cal State Dominguez Hills": /library|campus/i,
  "CSU Monterey Bay": /library|campus/i,
  "Amherst": /johnson chapel|frost library/i,
  "Williams": /chapin hall|hopkins hall/i,
  "Swarthmore": /parrish hall/i,
  "Pomona College": /sumner hall|marston quad/i,
  "Claremont McKenna": /bauer center|parents field/i,
  "Harvey Mudd": /platt campus center|jacobs science/i,
  "Wesleyan": /south college|olin library/i,
  "Middlebury": /old chapel|mead chapel/i,
  "Bowdoin": /massachusetts hall|hubbard hall/i,
  "Bates": /hathorn hall/i,
  "Hamilton College": /chapel|college hill/i,
  "Vassar": /main building|thompson library/i,
  "Barnard": /milbank|barnard hall/i,
  "Colgate": /memorial chapel|academic quad/i,
  "Bucknell": /old main/i,
  "Richmond": /westhampton|jepson/i,
  "Davidson": /chambers building/i,
  "Washington and Lee": /colonnade|lee chapel/i,
  "Grinnell": /mears cottage|burling library/i,
  "Carleton": /skinner memorial chapel|bald spot/i,
  "Macalester": /old main/i,
  "Oberlin": /tappan square|peters hall/i,
  "Kenyon": /old kenyon|middle path/i,
  "Smith": /college hall|paradise pond/i,
  "Mount Holyoke": /mary lyon hall|library/i,
  "Occidental": /johnson hall|academic quad/i,
  "Scripps": /balch hall|elm tree lawn/i,
  "Fairfield University": /bellarmine hall|egan chapel/i,
  "Rhodes College": /halliburton tower|palmer hall/i,
  "Denison University": /swasey chapel/i,
  "Furman University": /bell tower|furman lake/i,
  "Trinity College (Connecticut)": /long walk|chapel/i,
  "Union College": /nott memorial/i,
  "Skidmore College": /case center|campus/i,
  "Loyola University Maryland": /humanities center|evergreen/i,
  "Loyola Chicago": /madonna della strada|lake shore/i,
  "University of San Francisco": /st\. ignatius church|lone mountain/i,
  "Elon University": /fonville fountain|college chapel/i,
  "Providence College": /harkins hall/i,
  "DePaul": /st\. vincent|quad/i,
  "University of San Diego": /immaculata|founders chapel/i,
  "University of Denver": /university hall|mary reed/i,
  "Cal State Bakersfield": /library|campus/i,
  "Xavier University": /bellarmine chapel|gallagher/i,
  "Creighton": /st\. john's church|administration/i,
  "VCU": /monroe park|cabell library/i,
  "Old Dominion": /webb center|kaufman mall/i,
  "Towson": /administration building|glen complex/i,
  "Kennesaw State": /campus green|hall/i,
  "Georgia State": /library plaza|urban campus/i,
  "University of North Texas": /union|library mall/i,
  "Texas Tech": /administration building|will rogers/i,
  "Texas State": /old main|quad/i,
  "University of Houston": /cullen family plaza|ezekiel cullen/i,
  "University of Texas at Dallas": /founders|campus/i,
  "Miami University (Ohio)": /upham hall|slant walk/i,
  "Bowling Green State University": /university hall|carillon/i,
  "Kent State": /rockwell hall|risman plaza/i,
  "Cleveland State": /library|main classroom/i,
  "West Virginia University": /woodburn hall/i,
  "Louisville": /grawemeyer hall/i,
  "Kentucky": /main building|administration/i,
  "Cincinnati": /mcmicken hall|campus/i,
  "UNC Charlotte": /belk tower|reese/i,
  "East Carolina": /wright building|mall/i,
  "Appalachian State": /sanford hall|app theatre/i,
  "Mississippi State": /lee hall|drill field/i,
  "Ole Miss": /lyceum|circle/i,
  "Louisiana State": /memorial tower|quad/i,
  "Arkansas": /old main/i,
  "New Mexico": /zimmerman library|duck pond/i,
  "Nevada Las Vegas": /flora dungan|campus/i,
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
