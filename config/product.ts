// Product packaging as configuration, not code paths (docs/spec.md §3).
//
// These are editable commercial defaults, not research findings. Change them
// here; nothing below should be hard-coded into a component or a function.
// Keep this module React-free: it is imported by the browser, the Netlify
// functions and the tests.

export const product = {
  /** One full audit, USD, one-time. */
  fullAuditPriceUsd: 79,
  /** Targets covered by one review / purchase. More can be saved on the list;
   *  which ones are included is always explicit, never silently truncated. */
  maxIncludedTargets: 6,
  /** One successful full audit per purchase … */
  successfulRunsPerPurchase: 1,
  /** … plus user-requested revision reruns inside the window. System retries
   *  and failed runs never consume these. */
  revisionRerunsPerPurchase: 2,
  rerunWindowDays: 30,
  /** What the free deterministic preview shows. */
  freePreview: { targetOverview: true, topRisk: true, activityAssessments: 1, comparables: 3 },
} as const;

export const MAX_INCLUDED_TARGETS: number = product.maxIncludedTargets;
