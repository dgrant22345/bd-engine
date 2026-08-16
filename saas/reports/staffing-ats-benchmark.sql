-- Reproducible DuckDB analysis for the BD Engine public ATS coverage benchmark.
-- Source snapshot: ResumeAI State of ATS 2026, commit 6f667a20d3e488d9a37a127ae5be90e77e35eec9.

CREATE OR REPLACE TEMP VIEW verified_employers AS
SELECT *
FROM read_csv(
  'saas/data/state-of-ats-2026-companies.csv',
  header = true,
  comment = '#'
)
WHERE verified = true;

CREATE OR REPLACE TEMP VIEW classified_employers AS
SELECT
  *,
  CASE
    WHEN ats_system IN (
      'Ashby', 'BambooHR', 'Greenhouse', 'Jobvite', 'Lever', 'Personio',
      'Recruitee', 'Rippling', 'SmartRecruiters', 'Workable', 'Workday'
    ) THEN 'Automatic import'
    WHEN ats_system IN ('ADP', 'iCIMS', 'Phenom People', 'SuccessFactors', 'Taleo')
      THEN 'Tracking only'
    ELSE 'Discovery or manual review'
  END AS bd_engine_handling_tier
FROM verified_employers;

CREATE OR REPLACE TEMP VIEW benchmark_summary AS
SELECT
  COUNT(*) AS verified_employers,
  COUNT(DISTINCT ats_system) AS distinct_ats_systems,
  COUNT(*) FILTER (WHERE bd_engine_handling_tier = 'Automatic import') AS automatic_import_employers,
  COUNT(*) FILTER (WHERE bd_engine_handling_tier = 'Tracking only') AS tracking_only_employers,
  COUNT(*) FILTER (WHERE bd_engine_handling_tier = 'Discovery or manual review') AS discovery_review_employers
FROM classified_employers;

CREATE OR REPLACE TEMP VIEW provider_coverage AS
SELECT
  ats_system AS provider,
  COUNT(*) AS verified_employers,
  COUNT(*)::DOUBLE / (SELECT COUNT(*) FROM classified_employers) AS verified_sample_share,
  bd_engine_handling_tier
FROM classified_employers
GROUP BY ats_system, bd_engine_handling_tier
ORDER BY verified_employers DESC, provider;

CREATE OR REPLACE TEMP VIEW industry_coverage AS
SELECT
  industry,
  COUNT(*) AS verified_employers,
  COUNT(*) FILTER (WHERE bd_engine_handling_tier = 'Automatic import') AS automatic_import_employers,
  COUNT(*) FILTER (WHERE bd_engine_handling_tier = 'Tracking only') AS tracking_only_employers,
  COUNT(*) FILTER (WHERE bd_engine_handling_tier = 'Discovery or manual review') AS discovery_review_employers,
  COUNT(*) FILTER (WHERE bd_engine_handling_tier = 'Automatic import')::DOUBLE / COUNT(*) AS automatic_import_share
FROM classified_employers
GROUP BY industry
ORDER BY verified_employers DESC, industry;

SELECT * FROM benchmark_summary;
SELECT * FROM provider_coverage;
SELECT * FROM industry_coverage;
