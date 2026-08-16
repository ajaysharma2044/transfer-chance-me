// Our own school marks: official primary colors (facts) + short monograms.
// We deliberately do not ship universities' trademarked logo files.

export interface SchoolMark {
  color: string;
  mono: string;   // 1–3 letter monogram for tiles
  word: string;   // short display wordmark
}

export const MARKS: Record<string, SchoolMark> = {
  "Brown":           { color: "#4E3629", mono: "B",   word: "Brown" },
  "Carnegie Mellon": { color: "#C41230", mono: "CM",  word: "Carnegie Mellon" },
  "Chicago":         { color: "#800000", mono: "Ch",  word: "UChicago" },
  "Columbia":        { color: "#5A9BD8", mono: "Co",  word: "Columbia" },
  "Cornell":         { color: "#B31B1B", mono: "C",   word: "Cornell" },
  "Dartmouth":       { color: "#00693E", mono: "Da",  word: "Dartmouth" },
  "Duke":            { color: "#012169", mono: "D",   word: "Duke" },
  "Emory":           { color: "#0C2340", mono: "E",   word: "Emory" },
  "Georgetown":      { color: "#041E42", mono: "G",   word: "Georgetown" },
  "Harvard":         { color: "#A51C30", mono: "H",   word: "Harvard" },
  "Johns Hopkins":   { color: "#002D72", mono: "JH",  word: "Johns Hopkins" },
  "MIT":             { color: "#A31F34", mono: "MIT", word: "MIT" },
  "Michigan":        { color: "#00274C", mono: "M",   word: "Michigan" },
  "Northwestern":    { color: "#4E2A84", mono: "NU",  word: "Northwestern" },
  "Notre Dame":      { color: "#0C2340", mono: "ND",  word: "Notre Dame" },
  "Princeton":       { color: "#E77500", mono: "P",   word: "Princeton" },
  "Rice":            { color: "#00205B", mono: "R",   word: "Rice" },
  "Stanford":        { color: "#8C1515", mono: "S",   word: "Stanford" },
  "UC Berkeley":     { color: "#002676", mono: "Cal", word: "Berkeley" },
  "UCLA":            { color: "#2774AE", mono: "LA",  word: "UCLA" },
  "UNC":             { color: "#4B9CD3", mono: "NC",  word: "UNC" },
  "UPenn":           { color: "#011F5B", mono: "UP",  word: "Penn" },
  "Vanderbilt":      { color: "#866D4B", mono: "V",   word: "Vanderbilt" },
  "Yale":            { color: "#00356B", mono: "Y",   word: "Yale" },
};

export function markOf(name: string): SchoolMark {
  return MARKS[name] ?? { color: "#55575c", mono: name.slice(0, 2), word: name };
}
