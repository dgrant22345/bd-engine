import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCanadaJobLocationSql,
  classifyJobRegion,
  locationMatchesGeography,
  parseGeographyFocus,
} from '../src/job-geography.js';

test('Canadian locations are classified consistently across provinces and remote labels', () => {
  const canadianLocations = [
    'Winnipeg, MB',
    'Halifax, NS',
    'Regina, Saskatchewan',
    "St. John's, NL",
    'Newfoundland and Labrador, NL',
    'Corner Brook, NL',
    'Charlottetown, PEI',
    'Whitehorse, Yukon',
    'Remote - Canada',
    'ON',
    'Toronto, ON / New York, NY',
  ];
  for (const location of canadianLocations) {
    assert.equal(classifyJobRegion({ location }), 'canada', location);
    assert.equal(locationMatchesGeography({ location }, 'canada'), true, location);
  }

  const foreignLocations = [
    ['Victoria, Australia', 'other'],
    ['London, UK', 'other'],
    ['Cambridge, MA', 'us'],
    ['Richmond, VA', 'us'],
    ['Amsterdam, NL', 'other'],
  ];
  for (const [location, region] of foreignLocations) {
    assert.equal(classifyJobRegion({ location }), region, location);
    assert.equal(locationMatchesGeography({ location }, 'canada'), false, location);
  }
});

test('Canada relational filter covers the same province and city families', () => {
  const sql = buildCanadaJobLocationSql('j.location');
  for (const token of [
    'manitoba',
    'saskatchewan',
    'nova scotia',
    'new brunswick',
    'newfoundland',
    'prince edward island',
    'yukon',
    'northwest territories',
    'nunavut',
    'winnipeg',
    'halifax',
    'regina',
    'saskatoon',
    "st. john''s",
  ]) {
    assert.match(sql, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), token);
  }
  assert.match(sql, /on\|bc\|ab\|qc\|ns\|mb\|sk\|nb\|pe\|pei\|yt\|nt\|nu/i);
  assert.match(sql, /newfoundland\( and labrador\)\?/i);
  assert.match(sql, /AND NOT/i, 'ambiguous Canadian city names should be disambiguated from explicit foreign locations');
});

test('geography focus defaults preserve North American jobs without allowing other regions', () => {
  assert.deepEqual(parseGeographyFocus(''), { canada: true, us: true, other: false });
  assert.deepEqual(parseGeographyFocus('Canada'), { canada: true, us: false, other: false });
  assert.deepEqual(parseGeographyFocus('Global'), { canada: true, us: true, other: true });
});
