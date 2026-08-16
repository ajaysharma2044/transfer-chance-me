// Our own school marks: official primary colors (facts) + short monograms.
// We deliberately do not ship universities' trademarked logo files.

export interface SchoolMark {
  color: string;
  mono: string;   // 1–3 letter monogram fallback
  word: string;   // short display wordmark
  domain: string; // official web domain — used to load the school's own favicon
}

export const MARKS: Record<string, SchoolMark> = {
  "Brown":           { color: "#4E3629", mono: "B",   word: "Brown",           domain: "brown.edu" },
  "Carnegie Mellon": { color: "#C41230", mono: "CM",  word: "Carnegie Mellon", domain: "cmu.edu" },
  "Chicago":         { color: "#800000", mono: "Ch",  word: "UChicago",        domain: "uchicago.edu" },
  "Columbia":        { color: "#5A9BD8", mono: "Co",  word: "Columbia",        domain: "columbia.edu" },
  "Cornell":         { color: "#B31B1B", mono: "C",   word: "Cornell",         domain: "cornell.edu" },
  "Dartmouth":       { color: "#00693E", mono: "Da",  word: "Dartmouth",       domain: "dartmouth.edu" },
  "Duke":            { color: "#012169", mono: "D",   word: "Duke",            domain: "duke.edu" },
  "Emory":           { color: "#0C2340", mono: "E",   word: "Emory",           domain: "emory.edu" },
  "Georgetown":      { color: "#041E42", mono: "G",   word: "Georgetown",      domain: "georgetown.edu" },
  "Harvard":         { color: "#A51C30", mono: "H",   word: "Harvard",         domain: "harvard.edu" },
  "Johns Hopkins":   { color: "#002D72", mono: "JH",  word: "Johns Hopkins",   domain: "jhu.edu" },
  "MIT":             { color: "#A31F34", mono: "MIT", word: "MIT",             domain: "mit.edu" },
  "Michigan":        { color: "#00274C", mono: "M",   word: "Michigan",        domain: "umich.edu" },
  "Northwestern":    { color: "#4E2A84", mono: "NU",  word: "Northwestern",    domain: "northwestern.edu" },
  "Notre Dame":      { color: "#0C2340", mono: "ND",  word: "Notre Dame",      domain: "nd.edu" },
  "Princeton":       { color: "#E77500", mono: "P",   word: "Princeton",       domain: "princeton.edu" },
  "Rice":            { color: "#00205B", mono: "R",   word: "Rice",            domain: "rice.edu" },
  "Stanford":        { color: "#8C1515", mono: "S",   word: "Stanford",        domain: "stanford.edu" },
  "UC Berkeley":     { color: "#002676", mono: "Cal", word: "Berkeley",        domain: "berkeley.edu" },
  "UCLA":            { color: "#2774AE", mono: "LA",  word: "UCLA",            domain: "ucla.edu" },
  "UNC":             { color: "#4B9CD3", mono: "NC",  word: "UNC",             domain: "unc.edu" },
  "UPenn":           { color: "#011F5B", mono: "UP",  word: "Penn",            domain: "upenn.edu" },
  "Vanderbilt":      { color: "#866D4B", mono: "V",   word: "Vanderbilt",      domain: "vanderbilt.edu" },
  "Yale":            { color: "#00356B", mono: "Y",   word: "Yale",            domain: "yale.edu" },
};

export function logoUrl(name: string, size = 64): string {
  return `https://www.google.com/s2/favicons?domain=${markOf(name).domain}&sz=${size}`;
}

export function markOf(name: string): SchoolMark {
  return MARKS[name] ?? { color: "#55575c", mono: name.slice(0, 2), word: name };
}
