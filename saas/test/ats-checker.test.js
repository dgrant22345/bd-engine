import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCoverageAudit,
  buildCoverageCsv,
  buildShareSummary,
  buildShareUrl,
  classifyCareerUrl,
  parseSharedAudit,
} from '../public/ats-checker.js';

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

test('ATS coverage share links contain aggregate counts and no submitted URLs', () => {
  const audit = buildCoverageAudit([
    'https://boards.greenhouse.io/private-company-list',
    'https://jobs.lever.co/another-private-target',
    'https://example.com/careers',
  ].join('\n'));
  const shareUrl = buildShareUrl(audit, 'https://bd.example/ats-checker?utm_source=linkedin');
  const parsed = new URL(shareUrl);

  assert.equal(parsed.origin, 'https://bd.example');
  assert.equal(parsed.pathname, '/ats-checker');
  assert.equal(parsed.searchParams.get('valid'), '3');
  assert.equal(parsed.searchParams.get('recognized'), '2');
  assert.equal(parsed.searchParams.get('utm_source'), 'shared-audit');
  assert.doesNotMatch(shareUrl, /private-company-list|another-private-target|example\.com/);
});

test('shared ATS audits are reconstructed from bounded aggregate counts', () => {
  const shared = parseSharedAudit('?shared=1&valid=3&recognized=2');
  assert.deepEqual(shared, {
    shared: true,
    results: [],
    totalCount: 3,
    validCount: 3,
    recognizedCount: 2,
    reviewCount: 1,
    invalidCount: 0,
    recognitionRate: 67,
    duplicateCount: 0,
    truncatedCount: 0,
  });
  assert.equal(parseSharedAudit('?shared=1&valid=51&recognized=2'), null);
  assert.equal(parseSharedAudit('?shared=1&valid=3&recognized=4'), null);
});
