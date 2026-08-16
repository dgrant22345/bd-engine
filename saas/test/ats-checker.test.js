import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCoverageAudit, buildCoverageCsv, buildShareSummary, classifyCareerUrl } from '../public/ats-checker.js';

test('ATS checker recognizes every provider advertised on the public page', () => {
  const examples = [
    ['https://boards.greenhouse.io/example', 'Greenhouse'],
    ['https://jobs.lever.co/example', 'Lever'],
    ['https://jobs.ashbyhq.com/example', 'Ashby'],
    ['https://careers.smartrecruiters.com/example', 'SmartRecruiters'],
    ['https://example.wd5.myworkdayjobs.com/jobs', 'Workday'],
    ['https://example.bamboohr.com/careers', 'BambooHR'],
    ['https://apply.workable.com/example', 'Workable'],
    ['https://jobs.jobvite.com/example/jobs', 'Jobvite'],
    ['https://example.recruitee.com', 'Recruitee'],
    ['https://example.jobs.personio.de', 'Personio'],
    ['https://ats.rippling.com/example/jobs', 'Rippling'],
  ];

  for (const [url, provider] of examples) {
    assert.deepEqual(classifyCareerUrl(url).provider, provider, url);
    assert.equal(classifyCareerUrl(url).status, 'recognized', url);
  }
});

test('ATS checker is cautious with ordinary careers pages', () => {
  const result = classifyCareerUrl('example.com/careers');
  assert.equal(result.status, 'review');
  assert.equal(result.hostname, 'example.com');
});

test('ATS checker rejects invalid and private destinations', () => {
  assert.equal(classifyCareerUrl('').status, 'invalid');
  assert.equal(classifyCareerUrl('http://localhost:8787').status, 'invalid');
  assert.equal(classifyCareerUrl('http://192.168.1.5/jobs').status, 'invalid');
  assert.equal(classifyCareerUrl('not a url').status, 'invalid');
});

test('ATS coverage audit reports an explicit valid-URL denominator', () => {
  const audit = buildCoverageAudit([
    'https://boards.greenhouse.io/example',
    'https://jobs.lever.co/example',
    'https://example.com/careers',
    'http://localhost:8787',
    'https://boards.greenhouse.io/example/',
  ].join('\n'));

  assert.equal(audit.totalCount, 4);
  assert.equal(audit.validCount, 3);
  assert.equal(audit.recognizedCount, 2);
  assert.equal(audit.reviewCount, 1);
  assert.equal(audit.invalidCount, 1);
  assert.equal(audit.recognitionRate, 67);
  assert.equal(audit.duplicateCount, 1);
});

test('ATS coverage audit enforces its 50-entry browser limit', () => {
  const urls = Array.from({ length: 52 }, (_, index) => `https://company-${index}.example.com/careers`);
  const audit = buildCoverageAudit(urls.join('\n'));

  assert.equal(audit.totalCount, 50);
  assert.equal(audit.truncatedCount, 2);
});

test('ATS coverage CSV exports every audited row and neutralizes formulas', () => {
  const audit = buildCoverageAudit('https://jobs.ashbyhq.com/example\n=not-a-url');
  const csv = buildCoverageCsv(audit);

  assert.match(csv, /"https:\/\/jobs\.ashbyhq\.com\/example","jobs\.ashbyhq\.com","Recognized","Ashby"/);
  assert.match(csv, /"'=not-a-url","","Invalid",""/);
});

test('ATS coverage summary preserves the denominator and the coverage caveat', () => {
  const audit = buildCoverageAudit([
    'https://boards.greenhouse.io/example',
    'https://jobs.lever.co/example',
    'https://example.com/careers',
  ].join('\n'));

  assert.equal(
    buildShareSummary(audit),
    'ATS coverage audit: 2 of 3 valid public URLs (67%) use a recognized ATS host. 1 URL still needs discovery. Host recognition is a compatibility signal, not a guarantee of complete or fresh job coverage.'
  );
});
