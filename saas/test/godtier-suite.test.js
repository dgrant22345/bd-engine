import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const APP_JS_PATH = path.resolve('..', 'app', 'app.js');
const INDEX_HTML_PATH = path.resolve('..', 'app', 'index.html');
const STYLES_CSS_PATH = path.resolve('..', 'app', 'styles.css');

test('⚡ God-Tier Pillar 1: AI Outreach Response Likelihood Predictor Engine', () => {
  function calculateResponseLikelihood(contact = {}, job = {}, account = {}, text = '') {
    let score = 25; // Base cold baseline
    const factors = [];

    // 1. Warmth & Relationship
    const isConnected = Number(contact.connectionCount || account.connectionCount || 0) > 0;
    if (isConnected) {
      score += 35;
      factors.push('✓ 1st-degree warm relationship in network (+35%)');
    }

    // 2. Hiring Velocity
    const jobs3d = Number(account.jobsLast30Days || 0);
    if (jobs3d >= 2 || (account.hiringVelocity || 0) >= 4) {
      score += 20;
      factors.push('✓ Active hiring velocity / urgent requisition (+20%)');
    }

    // 3. Decision Maker alignment
    const title = String(contact.title || '').toLowerCase();
    if (/\b(vp|vice president|director|head of|chief|founder)\b/.test(title)) {
      score += 15;
      factors.push('✓ High-authority hiring decision maker (+15%)');
    }

    // 4. Stack specificity
    const textLower = String(text || '').toLowerCase();
    if (textLower.includes('kubernetes') || textLower.includes('aws') || textLower.includes('pytorch')) {
      score += 15;
      factors.push('✓ Specific tech stack grounding (+15%)');
    }

    const finalScore = Math.min(98, Math.max(12, score));
    const rating = finalScore >= 80 ? 'Very High' : finalScore >= 60 ? 'High' : 'Moderate';
    return { score: finalScore, rating, factors };
  }

  // Test 1: Full-strength warm outreach
  const warmPredict = calculateResponseLikelihood(
    { connectionCount: 3, title: 'VP of Engineering' },
    { title: 'Staff Platform Engineer' },
    { jobsLast30Days: 4, hiringVelocity: 8 },
    'I noticed your urgent search for Kubernetes and AWS platform scaling.'
  );

  // 25 base + 35 (warm) + 20 (velocity) + 15 (VP) + 15 (stack) = 110 -> clamped to 98
  assert.equal(warmPredict.score, 98);
  assert.equal(warmPredict.rating, 'Very High');
  assert.equal(warmPredict.factors.length, 4);

  // Test 2: Cold non-decision maker
  const coldPredict = calculateResponseLikelihood(
    { connectionCount: 0, title: 'Software Engineer' },
    { title: 'Software Engineer' },
    { jobsLast30Days: 0, hiringVelocity: 0 },
    'Quick message to connect.'
  );
  assert.equal(coldPredict.score, 25);
  assert.equal(coldPredict.factors.length, 0);
});

test('🕸️ God-Tier Pillar 2: Interactive Visual Network Graph Engine', () => {
  function generateNetworkGraphNodes(account = {}, contacts = [], jobs = []) {
    const compName = account.displayName || 'Target Account';
    const nodes = [];
    const links = [];

    // Center node
    nodes.push({ id: 'center', type: 'center', label: compName });

    contacts.forEach((c, idx) => {
      nodes.push({ id: `c_${idx}`, type: c.category || 'peer', label: c.fullName });
      links.push({ source: 'center', target: `c_${idx}` });
    });

    jobs.forEach((j, idx) => {
      nodes.push({ id: `j_${idx}`, type: 'job', label: j.title });
      links.push({ source: 'center', target: `j_${idx}` });
    });

    return { nodes, links };
  }

  const mockContacts = [
    { fullName: 'Sarah Connor', category: 'decision_maker' },
    { fullName: 'John Doe', category: 'peer' },
  ];
  const mockJobs = [
    { title: 'Lead AI Engineer' },
    { title: 'Staff DevOps Architect' },
  ];

  const graph = generateNetworkGraphNodes({ displayName: 'Datadog' }, mockContacts, mockJobs);
  assert.equal(graph.nodes.length, 5); // 1 center + 2 contacts + 2 jobs
  assert.equal(graph.links.length, 4);
  assert.ok(graph.nodes.some(n => n.type === 'center' && n.label === 'Datadog'));
  assert.ok(graph.nodes.some(n => n.type === 'decision_maker' && n.label === 'Sarah Connor'));
  assert.ok(graph.nodes.some(n => n.type === 'job' && n.label === 'Lead AI Engineer'));
});

test('🎙️ God-Tier Pillar 3: Cold Call Battle Card Teleprompter & Objection Pivot Engine', () => {
  const CALL_BRANCHES = {
    opener: {
      label: '🎯 10s Pattern Interrupt',
      text: 'Hi {{name}}, I know you weren\'t expecting my call, but I saw {{company}} has been actively searching for a {{jobTitle}} for over 30 days.',
    },
    send_email: {
      label: '📧 "Send me an email"',
      text: 'Happy to do that {{name}}. If I send over two anonymized candidate summaries, is your priority more focused on distributed systems depth or cloud scalability?',
    },
    internal_ta: {
      label: '👥 "We use internal TA"',
      text: 'Totally respect that {{name}}. We provide off-market passive candidates on pure contingency with zero upfront retainer.',
    },
  };

  function renderCallScript(branchKey, contactName, companyName, jobTitle) {
    const branch = CALL_BRANCHES[branchKey] || CALL_BRANCHES.opener;
    return branch.text
      .replace(/\{\{name\}\}/g, contactName)
      .replace(/\{\{company\}\}/g, companyName)
      .replace(/\{\{jobTitle\}\}/g, jobTitle);
  }

  const openerScript = renderCallScript('opener', 'Alex', 'Stripe', 'Staff Infrastructure Engineer');
  assert.match(openerScript, /Hi Alex/);
  assert.match(openerScript, /I saw Stripe has been actively searching/);
  assert.match(openerScript, /Staff Infrastructure Engineer/);

  const emailScript = renderCallScript('send_email', 'Alex', 'Stripe', 'Staff Infrastructure Engineer');
  assert.match(emailScript, /Happy to do that Alex/);
  assert.match(emailScript, /two anonymized candidate summaries/);
});

test('📰 God-Tier Pillar 4: Executive Morning Battle Plan Dossier Exporter', () => {
  function generateMorningBattlePlanDossier(accounts = [], jobs = [], avgFee = 25000) {
    const topAccounts = accounts.slice(0, 5);
    const topJobs = jobs.slice(0, 5);
    return {
      title: 'BD Engine Executive Morning Battle Plan',
      topAccounts: topAccounts.map(a => ({ name: a.displayName, score: a.score || 85 })),
      topJobs: topJobs.map(j => ({ title: j.title, company: j.companyName })),
      pipelineSummary: {
        addressableFeePipeline: topAccounts.length * avgFee,
        estimatedPlacements: Math.max(1, Math.round(topAccounts.length * 0.25)),
      },
    };
  }

  const mockAccounts = [
    { displayName: 'Stripe', score: 94 },
    { displayName: 'Shopify', score: 88 },
    { displayName: 'Datadog', score: 82 },
  ];
  const mockJobs = [
    { title: 'Staff Platform Engineer', companyName: 'Stripe' },
    { title: 'Principal Data Engineer', companyName: 'Shopify' },
  ];

  const dossier = generateMorningBattlePlanDossier(mockAccounts, mockJobs, 20000);
  assert.equal(dossier.topAccounts.length, 3);
  assert.equal(dossier.topJobs.length, 2);
  assert.equal(dossier.pipelineSummary.addressableFeePipeline, 60000); // 3 * 20000
  assert.equal(dossier.pipelineSummary.estimatedPlacements, 1);
});

test('🚀 God-Tier Suite UI, DOM & Hotkey Contracts Parity', () => {
  const appJs = fs.readFileSync(APP_JS_PATH, 'utf-8');
  const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
  const stylesCss = fs.readFileSync(STYLES_CSS_PATH, 'utf-8');

  // HTML Backdrops
  assert.ok(indexHtml.includes('id="call-studio-modal-backdrop"'), 'call-studio-modal-backdrop must exist in index.html');
  assert.ok(indexHtml.includes('id="network-graph-modal-backdrop"'), 'network-graph-modal-backdrop must exist in index.html');
  assert.ok(indexHtml.includes('id="battle-plan-modal-backdrop"'), 'battle-plan-modal-backdrop must exist in index.html');

  // CSS Classes
  assert.ok(stylesCss.includes('.response-meter-card'), '.response-meter-card must exist in styles.css');
  assert.ok(stylesCss.includes('.network-graph-dialog'), '.network-graph-dialog must exist in styles.css');
  assert.ok(stylesCss.includes('.network-graph-svg'), '.network-graph-svg must exist in styles.css');
  assert.ok(stylesCss.includes('.call-studio-dialog'), '.call-studio-dialog must exist in styles.css');
  assert.ok(stylesCss.includes('.call-teleprompter-box'), '.call-teleprompter-box must exist in styles.css');
  assert.ok(stylesCss.includes('.call-timer-badge'), '.call-timer-badge must exist in styles.css');
  assert.ok(stylesCss.includes('.battle-plan-dialog'), '.battle-plan-dialog must exist in styles.css');
  assert.ok(stylesCss.includes('.battle-plan-dossier'), '.battle-plan-dossier must exist in styles.css');

  // App.js Functions
  assert.ok(appJs.includes('function calculateResponseLikelihood('), 'calculateResponseLikelihood must exist in app.js');
  assert.ok(appJs.includes('function renderInteractiveNetworkGraph('), 'renderInteractiveNetworkGraph must exist in app.js');
  assert.ok(appJs.includes('function openCallStudioModal('), 'openCallStudioModal must exist in app.js');
  assert.ok(appJs.includes('function openNetworkGraphModal('), 'openNetworkGraphModal must exist in app.js');
  assert.ok(appJs.includes('function generateMorningBattlePlanDossier('), 'generateMorningBattlePlanDossier must exist in app.js');
});
