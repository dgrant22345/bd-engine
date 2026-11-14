import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../app/app.js', import.meta.url), 'utf8');
const start = source.indexOf('function generateWarmStudioCopy(');
const end = source.indexOf('\n}', start) + 2;
const generate = vm.runInNewContext(`(${source.slice(start, end)})`, { appState: { bootstrap: { user: { name: 'Derek' } } }, performance });
const base = {
  job: { title: 'Senior Data Engineer', companyName: 'Acme', location: 'Toronto', description: 'Requirements: experience building pipelines with Python and Spark.' },
  selectedContact: { fullName: 'Jamie Chen', title: 'Talent Acquisition Manager' },
  selectedTone: 'direct', goal: 'recruiting',
  background: 'I recruit data engineers across Ontario.',
};

test('role-specific first touches are concise and remove canned filler and invented selling claims', () => {
  const draft = generate(base);
  assert.match(draft.referralDm, /Senior Data Engineer/);
  assert.match(draft.referralDm, /Toronto/);
  assert.match(draft.referralDm, /Python and Spark/);
  assert.match(draft.referralDm, /I recruit data engineers across Ontario\./);
  assert.match(draft.referralDm, /outside recruiting support/);
  assert.doesNotMatch(draft.referralDm, /caught my attention|especially the|hardest to find|Given your role|If appropriate|hope this finds|market map|I help teams/i);
  assert.ok(draft.referralDm.split(/\s+/).length < 85);
  assert.equal((draft.referralDm.match(/\?/g) || []).length, 1);
});

test('the question fits the recipient without treating every employee as the hiring owner', () => {
  const talent = generate(base).referralDm;
  const peer = generate({ ...base, selectedContact: { fullName: 'Robin', title: 'Data Engineer' } }).referralDm;
  const executive = generate({ ...base, selectedContact: { fullName: 'Sam', title: 'Chief Financial Officer' } }).referralDm;
  assert.notEqual(talent, peer);
  assert.match(peer, /who is handling|right person|who.*contact/i);
  assert.match(executive, /who.*contact|who.*speak|right person/i);
  assert.doesNotMatch(peer + executive, /your search|you are hiring|your team needs/i);
});

test('real relationship context and the user question stay intact in every tone', () => {
  for (const selectedTone of ['casual', 'direct', 'professional']) {
    const draft = generate({ ...base, selectedTone, relationship: 'We met at the Toronto data meetup.', ask: 'Is your team open to a specialist agency on this role?' });
    assert.match(draft.referralDm, /We met at the Toronto data meetup\./);
    assert.match(draft.referralDm, /Is your team open to a specialist agency on this role\?/);
    assert.doesNotMatch(draft.referralDm, /If appropriate|if appropriate/);
    assert.equal((draft.referralDm.match(/\?/g) || []).length, 1);
  }
});

test('missing or closed roles never become invented openings or applicant credentials', () => {
  for (const job of [null, { ...base.job, active: false }]) {
    const draft = generate({ ...base, job, account: { displayName: 'Acme' }, background: '' });
    assert.doesNotMatch(draft.referralDm, /\[role|opening|is hiring|currently hiring|my experience|I specialize|I recruit/);
  }
  const applicant = generate({ ...base, goal: 'job_search', background: '' });
  assert.match(applicant.referralDm, /I'm interested in/);
  assert.doesNotMatch(applicant.recruiterPitch, /I can send a short summary|I recruit|my qualifications|perfect fit/);
});

test('negated requirements are not used as a personalization hook', () => {
  const draft = generate({ ...base, job: { ...base.job, description: 'Python is not required. We do not use Spark. Experience with SQL is required.' } });
  assert.doesNotMatch(draft.referralDm, /posting mentions Python|posting mentions Spark|Python and Spark/);
  assert.match(draft.referralDm, /SQL/);
});

test('connection notes fit their channel without cutting sentences or adding a second pitch', () => {
  const draft = generate({ ...base, job: { ...base.job, title: 'Senior '.repeat(50), companyName: 'Very long company '.repeat(30) }, relationship: 'Context '.repeat(70), ask: 'A long question '.repeat(20) });
  assert.ok(draft.linkedinNote.length <= 300);
  assert.doesNotMatch(draft.linkedinNote, /\.\.\.$|…$/);
  assert.equal(generate(base).recruiterPitch, generate(base).referralDm);
});
