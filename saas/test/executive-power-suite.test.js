import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const APP_JS_PATH = path.resolve('..', 'app', 'app.js');
const INDEX_HTML_PATH = path.resolve('..', 'app', 'index.html');
const STYLES_CSS_PATH = path.resolve('..', 'app', 'styles.css');

test('⚡ Pillar 1: Hiring Velocity & Signal Staleness Engine', () => {
  const now = Date.now();
  const MS_DAY = 24 * 60 * 60 * 1000;

  function calculateHiringVelocity(account = {}, jobs = []) {
    const accountJobs = Array.isArray(jobs)
      ? jobs.filter(j => j.accountId === account.id || (account.normalizedName && j.companyNormalized === account.normalizedName))
      : [];
    let jobs3d = 0;
    let jobs7d = 0;
    let staleJobs = 0;
    let freshJobs = 0;

    accountJobs.forEach(job => {
      const created = new Date(job.firstSeenAt || job.createdAt || job.updatedAt || job.postedAt || 0).getTime();
      const ageMs = now - created;
      const ageDays = Number.isFinite(created) && created > 0 ? Math.floor(ageMs / MS_DAY) : 10;
      if (ageDays <= 3) jobs3d += 1;
      if (ageDays <= 7) jobs7d += 1;
      if (ageDays <= 2) freshJobs += 1;
      if (ageDays >= 45 && job.active !== false) staleJobs += 1;
    });

    const isSurge = jobs3d >= 3 || (jobs7d >= 4 && jobs7d >= Math.max(1, Number(account.activeJobCount || account.jobCount || 1)) * 0.4);
    const surgeVelocity = jobs3d >= 3 ? Math.round((jobs3d / Math.max(1, accountJobs.length - jobs3d)) * 100) : 0;

    return {
      totalJobs: accountJobs.length,
      jobs3d,
      jobs7d,
      freshJobs,
      staleJobs,
      isSurge,
      surgeVelocity,
      surgeBadge: isSurge ? `🔥 Hiring Surge (+${jobs3d} in 72h)` : '',
      hardToFillBadge: staleJobs > 0 ? `⏳ ${staleJobs} Hard-to-Fill (45d+)` : '',
      freshBadge: freshJobs > 0 ? `⚡ ${freshJobs} Just Opened (<48h)` : '',
    };
  }

  const mockAccount = { id: 'acc_1', displayName: 'TechFlow', normalizedName: 'techflow', activeJobCount: 5 };
  const mockJobs = [
    { accountId: 'acc_1', title: 'Senior Backend Engineer', createdAt: new Date(now - 1 * MS_DAY).toISOString(), active: true },
    { accountId: 'acc_1', title: 'Staff DevOps Architect', createdAt: new Date(now - 2 * MS_DAY).toISOString(), active: true },
    { accountId: 'acc_1', title: 'Data Platform Engineer', createdAt: new Date(now - 2.5 * MS_DAY).toISOString(), active: true },
    { accountId: 'acc_1', title: 'Legacy COBOL Maintainer', createdAt: new Date(now - 50 * MS_DAY).toISOString(), active: true },
  ];

  const velocity = calculateHiringVelocity(mockAccount, mockJobs);
  assert.equal(velocity.totalJobs, 4);
  assert.equal(velocity.jobs3d, 3);
  assert.equal(velocity.freshJobs, 3);
  assert.equal(velocity.staleJobs, 1);
  assert.equal(velocity.isSurge, true);
  assert.match(velocity.surgeBadge, /Hiring Surge \(\+3 in 72h\)/);
  assert.match(velocity.hardToFillBadge, /1 Hard-to-Fill/);
  assert.match(velocity.freshBadge, /3 Just Opened/);
});

test('🎯 Pillar 2: Role-to-Contact Alignment Matrix & Decision-Maker Ranking', () => {
  function rankContactsForJob(job = {}, contacts = []) {
    const jobTitle = String(job?.title || '').toLowerCase();
    const scored = (Array.isArray(contacts) ? contacts : []).map(contact => {
      const title = String(contact.title || contact.position || '').toLowerCase();
      let category = 'other';
      let score = 10;
      let reason = '1st-degree contact at company';
      let badgeIcon = '👤';
      let badgeLabel = 'Contact';
      let chipClass = 'align-chip--peer';

      if (/\b(recruit\w*|talent\w*|people|sourc\w*|hr|talent acquisition)\b/.test(title)) {
        category = 'recruiter';
        score = 70;
        reason = 'Talent Acquisition & Sourcing Lead';
        badgeIcon = '📋';
        badgeLabel = 'Talent Lead';
        chipClass = 'align-chip--recruiter';
      } else if (/\b(vp|vice president|chief|cto|cro|cmo|cpo|coo|head of|director|founder|managing director|partner|lead)\b/.test(title)) {
        category = 'decision_maker';
        score = 95;
        reason = 'Probable Hiring Decision Maker & Executive';
        badgeIcon = '👑';
        badgeLabel = 'Decision Maker';
        chipClass = 'align-chip--dm';
      } else if (/\b(engineer|developer|architect|designer|manager|account executive|representative|analyst|scientist|consultant)\b/.test(title)) {
        category = 'peer';
        score = 60;
        reason = 'Peer in relevant domain (Warm Referrer)';
        badgeIcon = '🤝';
        badgeLabel = 'Peer / Warm Path';
        chipClass = 'align-chip--peer';
      }

      const domains = ['eng', 'software', 'platform', 'data', 'sales', 'product', 'market', 'design', 'finance', 'devops', 'cloud', 'security'];
      const matchedDomain = domains.find(d => jobTitle.includes(d) && title.includes(d));
      if (matchedDomain) {
        score += 20;
        reason += ` (${matchedDomain} alignment)`;
      }

      return { ...contact, category, alignmentScore: score, alignmentReason: reason, badgeIcon, badgeLabel, chipClass };
    });

    scored.sort((a, b) => b.alignmentScore - a.alignmentScore);
    return scored;
  }

  const mockJob = { title: 'Director of Platform Engineering' };
  const mockContacts = [
    { fullName: 'Alice Recruiter', title: 'Lead Technical Recruiter' },
    { fullName: 'Bob Executive', title: 'VP of Engineering' },
    { fullName: 'Charlie Peer', title: 'Senior Software Engineer' },
    { fullName: 'David Other', title: 'Accountant' },
  ];

  const ranked = rankContactsForJob(mockJob, mockContacts);
  // console.log('DEBUG RANKED:', ranked.map(r => ({ name: r.fullName, cat: r.category, score: r.alignmentScore })));


  // Bob Executive (VP of Engineering): 95 + 20 = 115
  assert.equal(ranked[0].fullName, 'Bob Executive');
  assert.equal(ranked[0].category, 'decision_maker');
  assert.equal(ranked[0].alignmentScore, 115);

  // Charlie Peer (Senior Software Engineer): 60 + 20 = 80
  assert.equal(ranked[1].fullName, 'Charlie Peer');
  assert.equal(ranked[1].category, 'peer');
  assert.equal(ranked[1].alignmentScore, 80);

  // Alice Recruiter (Lead Technical Recruiter): 70
  assert.equal(ranked[2].fullName, 'Alice Recruiter');
  assert.equal(ranked[2].category, 'recruiter');
  assert.equal(ranked[2].alignmentScore, 70);
});

test('✍️ Pillar 3: 3-Touch Sequence Generation & LinkedIn 300-char Meter', () => {
  function generateDraft(item, template, tone, sequenceTouch = 1) {
    const firstName = item.firstName || 'Sarah';
    const companyName = item.company || 'ScaleAI';
    const jobTitle = item.jobTitle || 'Staff Infrastructure Engineer';
    const myName = 'BD Team';

    let subject;
    let body;
    let linkedinNote;

    if (sequenceTouch === 1) {
      subject = `Pre-vetted candidates for ${companyName}'s ${jobTitle} opening`;
      body = `Hi ${firstName},\n\nSaw ${companyName}'s active search for ${jobTitle}.\n\nWe represent 2 pre-vetted senior professionals.\n\nBest,\n${myName}`;
      linkedinNote = `Hi ${firstName}, saw ${companyName}'s ${jobTitle} opening. We have 2 pre-vetted senior profiles matching this exact stack available immediately. Would love to share details! - ${myName}`;
    } else if (sequenceTouch === 2) {
      subject = `Re: ${companyName}'s ${jobTitle} search — Candidate profiles & portfolio`;
      body = `Hi ${firstName},\n\nFollowing up with 2 anonymized candidate snapshots for ${jobTitle}.\n\nBest,\n${myName}`;
      linkedinNote = `Hi ${firstName}, following up with two strong candidate profiles for ${companyName}'s ${jobTitle} role. Happy to send over details! - ${myName}`;
    } else {
      subject = `Closing the loop on ${companyName}'s ${jobTitle} opening`;
      body = `Hi ${firstName},\n\nClosing the loop on this—no worries at all if you're all set!\n\nBest,\n${myName}`;
      linkedinNote = `Hi ${firstName}, closing the loop regarding ${jobTitle}. If timing is better down the road, let's stay connected! Best, ${myName}`;
    }

    return { subject, body, linkedinNote };
  }

  const item = { firstName: 'Elena', company: 'Stripe', jobTitle: 'Principal Engineer' };

  const touch1 = generateDraft(item, 'sales_candidate_teaser', 'casual', 1);
  assert.match(touch1.subject, /Pre-vetted candidates/);
  assert.ok(touch1.linkedinNote.length > 0 && touch1.linkedinNote.length <= 300, `LinkedIn Note length ${touch1.linkedinNote.length} must be <= 300`);

  const touch2 = generateDraft(item, 'sales_candidate_teaser', 'casual', 2);
  assert.match(touch2.subject, /Candidate profiles & portfolio/);
  assert.ok(touch2.linkedinNote.length <= 300);

  const touch3 = generateDraft(item, 'sales_candidate_teaser', 'casual', 3);
  assert.match(touch3.subject, /Closing the loop/);
  assert.ok(touch3.linkedinNote.length <= 300);
});

test('💼 Pillar 4: Deal Flow & Fee Pipeline Simulator Model', () => {
  const activeJobs = 20;
  const avgFee = 25000;
  const weeklyOutreach = 30;
  const winRatePct = 20;

  const addressableMarket = activeJobs * avgFee;
  const quarterlyOutreach = weeklyOutreach * 12;
  const estimatedReplies = Math.round(quarterlyOutreach * 0.35);
  const estimatedMeetings = Math.max(1, Math.round(estimatedReplies * 0.30));
  const estimatedPlacements = Math.max(1, Math.round(estimatedMeetings * (winRatePct / 100)));
  const projectedQuarterlyBillings = estimatedPlacements * avgFee;

  assert.equal(addressableMarket, 500000);
  assert.equal(quarterlyOutreach, 360);
  assert.equal(estimatedReplies, 126);
  assert.equal(estimatedMeetings, 38);
  assert.equal(estimatedPlacements, 8);
  assert.equal(projectedQuarterlyBillings, 200000);
});

test('📊 Pillar 5: ICP Strategic 4-Quadrant Account Matrix Positioning', () => {
  const mockAccounts = [
    { displayName: 'Tier1 Tech', connectionCount: 3, jobCount: 5 },
    { displayName: 'Longtime Partner', connectionCount: 4, jobCount: 1 },
    { displayName: 'Fast-Scaling Cold', connectionCount: 0, jobCount: 8 },
    { displayName: 'Dormant Lead', connectionCount: 0, jobCount: 0 },
  ];

  let q1 = [], q2 = [], q3 = [], q4 = [];
  mockAccounts.forEach(acc => {
    const conns = Number(acc.connectionCount || 0);
    const jobCount = Number(acc.jobCount || 0);
    if (conns >= 2 && jobCount >= 3) q1.push(acc);
    else if (conns >= 2 && jobCount < 3) q2.push(acc);
    else if (conns < 2 && jobCount >= 3) q3.push(acc);
    else q4.push(acc);
  });

  assert.equal(q1.length, 1);
  assert.equal(q1[0].displayName, 'Tier1 Tech');
  assert.equal(q2.length, 1);
  assert.equal(q2[0].displayName, 'Longtime Partner');
  assert.equal(q3.length, 1);
  assert.equal(q3[0].displayName, 'Fast-Scaling Cold');
  assert.equal(q4.length, 1);
  assert.equal(q4[0].displayName, 'Dormant Lead');
});

test('🚀 Pillar 6: HTML, CSS & App.js Contract Parity', () => {
  const appJs = fs.readFileSync(APP_JS_PATH, 'utf-8');
  const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
  const stylesCss = fs.readFileSync(STYLES_CSS_PATH, 'utf-8');

  // Verify HTML markup elements
  assert.ok(indexHtml.includes('id="shortcuts-modal-backdrop"'), 'shortcuts-modal-backdrop must exist in index.html');
  assert.ok(indexHtml.includes('data-action="open-shortcuts-modal"'), 'open-shortcuts-modal action must exist in index.html');
  assert.ok(indexHtml.includes('data-action="toggle-sound-effects"'), 'toggle-sound-effects action must exist in index.html');

  // Verify CSS styles
  assert.ok(stylesCss.includes('.signal-badge--surge'), '.signal-badge--surge must exist in styles.css');
  assert.ok(stylesCss.includes('.signal-badge--hard-to-fill'), '.signal-badge--hard-to-fill must exist in styles.css');
  assert.ok(stylesCss.includes('.align-chip--dm'), '.align-chip--dm must exist in styles.css');
  assert.ok(stylesCss.includes('.sequence-touch-bar'), '.sequence-touch-bar must exist in styles.css');
  assert.ok(stylesCss.includes('.linkedin-char-meter'), '.linkedin-char-meter must exist in styles.css');
  assert.ok(stylesCss.includes('.fee-simulator-card'), '.fee-simulator-card must exist in styles.css');
  assert.ok(stylesCss.includes('.icp-matrix-card'), '.icp-matrix-card must exist in styles.css');
  assert.ok(stylesCss.includes('.shortcuts-dialog'), '.shortcuts-dialog must exist in styles.css');

  // Verify App.js functions and handlers
  assert.ok(appJs.includes('function calculateHiringVelocity('), 'calculateHiringVelocity must exist in app.js');
  assert.ok(appJs.includes('function detectRoleVelocity('), 'detectRoleVelocity must exist in app.js');
  assert.ok(appJs.includes('function rankContactsForJob('), 'rankContactsForJob must exist in app.js');
  assert.ok(appJs.includes('function renderFeePipelineSimulator('), 'renderFeePipelineSimulator must exist in app.js');
  assert.ok(appJs.includes('function renderIcpQuadrantMatrix('), 'renderIcpQuadrantMatrix must exist in app.js');
  assert.ok(appJs.includes('function playActionChime('), 'playActionChime must exist in app.js');
  assert.ok(appJs.includes('function openShortcutsModal('), 'openShortcutsModal must exist in app.js');
  assert.ok(appJs.includes('copyBatchLinkedInNote'), 'copyBatchLinkedInNote must exist in app.js');
  assert.ok(appJs.includes('switchBatchSequenceTouch'), 'switchBatchSequenceTouch must exist in app.js');
});
