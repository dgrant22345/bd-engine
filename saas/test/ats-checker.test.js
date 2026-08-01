import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyCareerUrl } from '../public/ats-checker.js';

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
