import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  SOURCE_SHA256,
  applyAccessibleReportTheme,
  buildBenchmarkAnalysis,
  buildProviderCsv,
  buildReportArtifact,
  parseDataset,
} from '../scripts/build-staffing-ats-benchmark.mjs';

const datasetPath = new URL('../data/state-of-ats-2026-companies.csv', import.meta.url);
const artifactPath = new URL('../reports/staffing-ats-benchmark.artifact.json', import.meta.url);
const providerCsvPath = new URL('../public/bd-engine-ats-coverage-benchmark.csv', import.meta.url);
const reportHtmlPath = new URL('../public/staffing-ats-benchmark.html', import.meta.url);

async function analysisFixture() {
  const sourceText = await readFile(datasetPath, 'utf8');
  return { sourceText, analysis: buildBenchmarkAnalysis(parseDataset(sourceText), sourceText) };
}

test('staffing ATS benchmark uses only the verified source cohort', async () => {
  const { analysis } = await analysisFixture();

  assert.equal(SOURCE_SHA256, 'c6036836e93a9c946fd5ef67bf40d576c57411822ad43de02d8a4e2c4b279a3d');
  assert.equal(analysis.totalRows, 738);
  assert.equal(analysis.verifiedCount, 704);
  assert.equal(analysis.excludedUnverifiedCount, 34);
  assert.equal(analysis.distinctProviderCount, 36);
  assert.equal(analysis.importReadyCount, 401);
  assert.equal(analysis.trackingOnlyCount, 130);
  assert.equal(analysis.reviewCount, 173);
  assert.equal(Math.round(analysis.importReadyShare * 1000), 570);
  assert.equal(Math.round(analysis.identifiedOrTrackedShare * 1000), 754);
});

test('provider and industry cuts preserve their own denominators', async () => {
  const { analysis } = await analysisFixture();
  const workday = analysis.providers.find((row) => row.provider === 'Workday');
  const technology = analysis.industries.find((row) => row.industry === 'Technology');
  const transportation = analysis.industries.find((row) => row.industry === 'Transportation');

  assert.deepEqual(workday, {
    provider: 'Workday',
    employerCount: 267,
    share: 267 / 704,
    sharePercent: 37.9,
    handlingTier: 'Automatic import',
  });
  assert.equal(technology.employerCount, 47);
  assert.equal(technology.importReadyCount, 31);
  assert.equal(Math.round(technology.importReadyShare * 100), 66);
  assert.equal(transportation.employerCount, 21);
  assert.equal(transportation.importReadyCount, 2);
  assert.equal(Math.round(transportation.importReadyShare * 100), 10);
});

test('checked-in report artifact and provider download are reproducible', async () => {
  const { analysis } = await analysisFixture();
  const [artifact, providerCsv] = await Promise.all([
    readFile(artifactPath, 'utf8'),
    readFile(providerCsvPath, 'utf8'),
  ]);

  assert.deepEqual(JSON.parse(artifact), buildReportArtifact(analysis));
  assert.equal(providerCsv.trim(), buildProviderCsv(analysis));
  assert.match(providerCsv, /"Workday","267","37\.9%","Automatic import"/);
  assert.match(providerCsv, /"SuccessFactors","68","9\.7%","Tracking only"/);
});

test('public report follows the answer-first stakeholder structure', async () => {
  const { analysis } = await analysisFixture();
  const artifact = buildReportArtifact(analysis);
  const blocks = artifact.manifest.blocks;

  assert.equal(blocks[0].body, '# BD Engine public ATS coverage benchmark');
  assert.match(blocks[1].body, /^## Executive Summary/);
  assert.equal(artifact.manifest.charts.length, 3);
  assert.equal(artifact.manifest.tables.length, 1);
  assert.equal(artifact.snapshot.status, 'ready');
  assert.match(blocks.find((block) => block.id === 'next_steps').body, /https:\/\/bd-engine-production\.up\.railway\.app\/ats-checker/);
  assert.match(blocks.find((block) => block.id === 'caveats').body, /not a claim that BD Engine independently re-verified every employer/);
});

test('public report keeps the accessible light-theme contrast override after regeneration', async () => {
  const reportHtml = await readFile(reportHtmlPath, 'utf8');
  const fixture = '<!doctype html><html><head><title>Report</title></head><body></body></html>';
  const themedFixture = applyAccessibleReportTheme(fixture);

  assert.match(reportHtml, /data-bd-engine-accessible-theme="true"/);
  assert.match(reportHtml, /--portable-tertiary:#5d5d5d/);
  assert.match(reportHtml, /--portable-accent:#005ea8/);
  assert.match(themedFixture, /data-bd-engine-accessible-theme="true"/);
  assert.equal(applyAccessibleReportTheme(themedFixture), themedFixture);
});
