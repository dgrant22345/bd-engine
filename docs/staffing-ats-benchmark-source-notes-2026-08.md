# Staffing ATS benchmark source notes — August 2026

## Reporting job

- **Audience:** staffing agency founders, desk leaders, and recruiters with BD responsibility.
- **Decision:** determine whether ATS fragmentation is material enough to audit a real target universe before promising hiring-signal coverage.
- **Cohort:** 704 employers marked verified in the pinned ResumeAI State of ATS 2026 CSV.
- **Comparison basis:** BD Engine provider handling as of August 16, 2026: automatic import, tracking only, or discovery/manual review.
- **Success criterion:** readers can see the denominator, provider mix, industry variation, limitations, and a concrete next step.

## Data-quality profile

| Check | Result | Assessment |
| --- | --- | --- |
| Row and column shape | 738 rows, 8 expected columns | Pass |
| Verified cohort | 704 verified, 34 excluded | Pass; matches CSV header |
| Candidate key | 738 unique slugs; no duplicate names | Pass |
| Required fields | No missing name, slug, industry, ATS, source URL, or verified flag | Pass |
| Allowed values | Valid boolean flags and hiring-volume tiers | Pass |
| Source URLs | 738 valid HTTPS URLs | Pass, with auditability limitation below |
| Source checksum | SHA-256 matches pinned upstream snapshot | Pass |
| Narrative consistency | Upstream README later claims 406 unverified and about 45% verified | Medium-severity documentation defect; ignore prose and calculate from rows |
| Row-level provenance | Published `source_url` values point to ResumeAI company pages, not raw employer apply URLs | Medium-severity auditability limitation; do not claim independent re-verification |

## Metric definitions

- **Automatic import:** provider is one of Workday, Greenhouse, SmartRecruiters, Ashby, Lever, Jobvite, Workable, Rippling, BambooHR, Recruitee, or Personio.
- **Tracking only:** provider is iCIMS, Taleo, ADP, SuccessFactors, or Phenom People.
- **Discovery or manual review:** every other provider in the verified cohort.
- **Share:** employers in the category divided by 704 verified employers. Industry shares use the verified employers in that industry as the denominator.

## Chart map

| Report section | Question | Form | Fields | Supported claim | Palette |
| --- | --- | --- | --- | --- | --- |
| Handling tiers | How much of the cohort is importable, trackable, or review-only? | Horizontal bar | tier, employer count, share | 401 automatic, 130 tracking-only, 173 review | Single-root blue |
| Provider distribution | Which systems drive the sample? | Ranked horizontal bar | provider, employer count, share, handling tier | Workday creates breadth; 36-system long tail remains | Single-root gold |
| Industry coverage | How much does target mix change automatic-import coverage? | Horizontal percent bar | industry, import-ready share, cohort counts | Largest-industry rates range from 10% to 66% | Single-root orange |

Bars begin at zero, use one quantitative series, and expose counts or denominators in tooltips. No time-series or causal claim is made.

## Reproducibility

- Vendored source: `saas/data/state-of-ats-2026-companies.csv`
- Transformation: `saas/scripts/build-staffing-ats-benchmark.mjs`
- Equivalent DuckDB analysis: `saas/reports/staffing-ats-benchmark.sql`
- Canonical report input: `saas/reports/staffing-ats-benchmark.artifact.json`
- Derived download: `saas/public/bd-engine-ats-coverage-benchmark.csv`

After the portable report renderer writes the HTML, run
`npm run build:ats-report` once more. The build is idempotent and applies the
checked-in WCAG contrast override to the final report without changing its data.

The artifact's visible structure maps to the stakeholder report contract:
title; Executive Summary; evidence-backed findings; next steps; further
questions; and caveats. Each chart has adjacent interpretation.
