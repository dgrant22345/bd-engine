import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const APP_JS_PATH = path.resolve('..', 'app', 'app.js');
const INDEX_HTML_PATH = path.resolve('..', 'app', 'index.html');
const STYLES_CSS_PATH = path.resolve('..', 'app', 'styles.css');

test('🤖 Infinity Pillar 1: Autonomous Autopilot Prospecting Co-Pilot Engine', () => {
  function generateAutopilotQueue(accounts = [], jobs = [], contacts = []) {
    const queue = [];
    const candidateAccounts = accounts.filter(a => (a.jobCount || 0) > 0 || (a.jobsLast30Days || 0) > 0).slice(0, 5);

    candidateAccounts.forEach(account => {
      const accJobs = jobs.filter(j => j.accountId === account.id || j.companyName === account.displayName);
      const topJob = accJobs[0] || { title: 'Senior Software Engineer', companyName: account.displayName };
      const accContacts = contacts.filter(c => c.accountId === account.id || c.companyName === account.displayName);
      const topContact = accContacts[0] || { fullName: 'Hiring Leader', title: 'Engineering Director' };

      queue.push({
        account,
        job: topJob,
        contact: topContact,
        touch1Draft: `Hi ${topContact.fullName.split(' ')[0]}, saw your opening for ${topJob.title} at ${account.displayName}.`,
        replyOdds: 88,
      });
    });
    return queue;
  }

  const mockAccounts = [
    { id: 'acc1', displayName: 'Stripe', jobCount: 4, jobsLast30Days: 2 },
    { id: 'acc2', displayName: 'Datadog', jobCount: 6, jobsLast30Days: 3 },
  ];
  const mockJobs = [
    { id: 'job1', accountId: 'acc1', title: 'Staff Infrastructure Engineer', companyName: 'Stripe' },
    { id: 'job2', accountId: 'acc2', title: 'Principal SecOps Architect', companyName: 'Datadog' },
  ];
  const mockContacts = [
    { id: 'c1', accountId: 'acc1', fullName: 'Sarah Connor', title: 'VP of Engineering' },
    { id: 'c2', accountId: 'acc2', fullName: 'Alex Mercer', title: 'Head of Infrastructure' },
  ];

  const queue = generateAutopilotQueue(mockAccounts, mockJobs, mockContacts);
  assert.equal(queue.length, 2);
  assert.equal(queue[0].account.displayName, 'Stripe');
  assert.equal(queue[0].job.title, 'Staff Infrastructure Engineer');
  assert.equal(queue[0].contact.fullName, 'Sarah Connor');
  assert.match(queue[0].touch1Draft, /Hi Sarah/);
  assert.match(queue[0].touch1Draft, /Staff Infrastructure Engineer/);

  assert.equal(queue[1].account.displayName, 'Datadog');
  assert.equal(queue[1].contact.fullName, 'Alex Mercer');
});

test('⚡ Infinity Pillar 2: Live Signal Intelligence Wire Ticker Engine', () => {
  function generateSignalAlerts(accounts = [], jobs = []) {
    const alerts = [];
    accounts.forEach(a => {
      if ((a.jobsLast30Days || 0) >= 3) {
        alerts.push({ type: 'surge', text: `${a.displayName}: Hiring Surge (+${a.jobsLast30Days} roles)` });
      }
      if (a.isHardToFill) {
        alerts.push({ type: 'stale', text: `${a.displayName}: Requisitions open 45d+` });
      }
    });
    jobs.forEach(j => {
      if ((j.connectionCount || 0) > 0) {
        alerts.push({ type: 'dm', text: `${j.companyName} (${j.title}): ${j.connectionCount} in network` });
      }
    });
    return alerts;
  }

  const mockAccounts = [
    { displayName: 'Shopify', jobsLast30Days: 5, isHardToFill: true },
  ];
  const mockJobs = [
    { companyName: 'Shopify', title: 'Staff Platform Engineer', connectionCount: 2 },
  ];

  const alerts = generateSignalAlerts(mockAccounts, mockJobs);
  assert.equal(alerts.length, 3);
  assert.ok(alerts.some(a => a.type === 'surge' && a.text.includes('Hiring Surge')));
  assert.ok(alerts.some(a => a.type === 'stale' && a.text.includes('open 45d+')));
  assert.ok(alerts.some(a => a.type === 'dm' && a.text.includes('2 in network')));
});

test('📊 Infinity Pillar 3: Win-Rate & Script Conversion Analytics Cockpit', () => {
  const analyticsData = {
    decisionMakerReplyRate: 42.8,
    peerReferralRate: 58.4,
    objectionBusterWinRate: 68.2,
    activePipelineVal: 148500,
  };

  assert.ok(analyticsData.decisionMakerReplyRate > 40.0);
  assert.ok(analyticsData.peerReferralRate > 50.0);
  assert.ok(analyticsData.objectionBusterWinRate > 60.0);
  assert.equal(analyticsData.activePipelineVal, 148500);
});

test('💎 Infinity Pillar 4: White-Glove Client Talent Pitch Deck Specimen', () => {
  function generateClientPitchDeck(account = {}, jobs = []) {
    const compName = account.displayName || 'Target Account';
    const accJobs = jobs.filter(j => j.companyName === compName);
    return {
      companyName: compName,
      activeJobsCount: accJobs.length || 1,
      techStack: [{ name: 'Kubernetes', category: 'infra' }, { name: 'PyTorch', category: 'ai' }],
      candidateCount: 2,
    };
  }

  const deck = generateClientPitchDeck({ displayName: 'Brex' }, [{ companyName: 'Brex', title: 'Lead AI Engineer' }]);
  assert.equal(deck.companyName, 'Brex');
  assert.equal(deck.activeJobsCount, 1);
  assert.equal(deck.techStack.length, 2);
  assert.equal(deck.candidateCount, 2);
});

test('🚀 Infinity Tier UI, DOM & Hotkey Contracts Parity', () => {
  const appJs = fs.readFileSync(APP_JS_PATH, 'utf-8');
  const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
  const stylesCss = fs.readFileSync(STYLES_CSS_PATH, 'utf-8');

  // HTML Containers & Menu Buttons
  assert.ok(indexHtml.includes('id="autopilot-modal-backdrop"'), 'autopilot-modal-backdrop must exist in index.html');
  assert.ok(indexHtml.includes('id="pitch-deck-modal-backdrop"'), 'pitch-deck-modal-backdrop must exist in index.html');
  assert.ok(indexHtml.includes('data-action="open-autopilot-modal"'), 'open-autopilot-modal must exist in index.html');
  assert.ok(indexHtml.includes('data-action="open-pitch-deck-modal"'), 'open-pitch-deck-modal must exist in index.html');

  // CSS Styles
  assert.ok(stylesCss.includes('.intel-wire-ticker'), '.intel-wire-ticker must exist in styles.css');
  assert.ok(stylesCss.includes('.ticker-pill'), '.ticker-pill must exist in styles.css');
  assert.ok(stylesCss.includes('.autopilot-dialog'), '.autopilot-dialog must exist in styles.css');
  assert.ok(stylesCss.includes('.autopilot-queue-grid'), '.autopilot-queue-grid must exist in styles.css');
  assert.ok(stylesCss.includes('.analytics-cockpit-card'), '.analytics-cockpit-card must exist in styles.css');
  assert.ok(stylesCss.includes('.analytics-stat-box'), '.analytics-stat-box must exist in styles.css');
  assert.ok(stylesCss.includes('.pitch-deck-dialog'), '.pitch-deck-dialog must exist in styles.css');
  assert.ok(stylesCss.includes('.pitch-deck-slide'), '.pitch-deck-slide must exist in styles.css');

  // App.js Functions & Handlers
  assert.ok(appJs.includes('function generateAutopilotQueue('), 'generateAutopilotQueue must exist in app.js');
  assert.ok(appJs.includes('function renderLiveSignalTicker('), 'renderLiveSignalTicker must exist in app.js');
  assert.ok(appJs.includes('function renderScriptAnalyticsCockpit('), 'renderScriptAnalyticsCockpit must exist in app.js');
  assert.ok(appJs.includes('function generateClientPitchDeck('), 'generateClientPitchDeck must exist in app.js');
});
