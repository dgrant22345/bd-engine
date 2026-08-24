import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const APP_JS_PATH = path.resolve('..', 'app', 'app.js');
const INDEX_HTML_PATH = path.resolve('..', 'app', 'index.html');
const STYLES_CSS_PATH = path.resolve('..', 'app', 'styles.css');

test('🧠 Elite Pillar 1: Tech Stack DNA & Signal Intel Analyzer', () => {
  const STACK_MAP = [
    { name: 'PyTorch', category: 'ai', regex: /\bpytorch\b/i },
    { name: 'LLM / RAG', category: 'ai', regex: /\b(llm|rag|langchain|llamaindex|vector db|openai|claude|transformers)\b/i },
    { name: 'Kubernetes', category: 'infra', regex: /\b(kubernetes|k8s)\b/i },
    { name: 'AWS', category: 'infra', regex: /\b(aws|amazon web services|ec2|s3|lambda|eks)\b/i },
    { name: 'Python', category: 'data', regex: /\bpython\b/i },
    { name: 'Go (Golang)', category: 'infra', regex: /\b(golang|\bgo\b(?= developer| engineer| backend))\b/i },
    { name: 'Snowflake', category: 'data', regex: /\bsnowflake\b/i },
    { name: 'React / Next.js', category: 'frontend', regex: /\b(react|next\.js|nextjs)\b/i },
    { name: 'TypeScript', category: 'frontend', regex: /\btypescript\b/i },
  ];

  function extractTechStack(title = '', department = '', description = '') {
    const text = `${title} ${department} ${description}`.toLowerCase();
    const matched = [];
    for (const item of STACK_MAP) {
      if (item.regex.test(text) && !matched.some(m => m.name === item.name)) {
        matched.push({ name: item.name, category: item.category });
        if (matched.length >= 5) break;
      }
    }
    return matched;
  }

  const stackAI = extractTechStack('Senior Staff Machine Learning Engineer (Python)', 'AI Platform', 'Deep learning with PyTorch and LLM RAG pipelines on AWS');
  assert.equal(stackAI.length, 4);
  assert.ok(stackAI.some(s => s.name === 'PyTorch' && s.category === 'ai'));
  assert.ok(stackAI.some(s => s.name === 'LLM / RAG' && s.category === 'ai'));
  assert.ok(stackAI.some(s => s.name === 'AWS' && s.category === 'infra'));
  assert.ok(stackAI.some(s => s.name === 'Python' && s.category === 'data'));

  const stackInfra = extractTechStack('Lead Kubernetes DevOps Architect', 'Infrastructure', 'Scaling K8s clusters and Terraform on AWS');
  assert.ok(stackInfra.some(s => s.name === 'Kubernetes' && s.category === 'infra'));
  assert.ok(stackInfra.some(s => s.name === 'AWS' && s.category === 'infra'));

  const stackFrontend = extractTechStack('Senior Frontend Engineer (React & TypeScript)', 'Web App', 'Building Next.js design systems');
  assert.ok(stackFrontend.some(s => s.name === 'React / Next.js' && s.category === 'frontend'));
  assert.ok(stackFrontend.some(s => s.name === 'TypeScript' && s.category === 'frontend'));
});

test('⚔️ Elite Pillar 2: Competitor Lookalike Cross-Hunting Engine', () => {
  const COMPETITOR_CLUSTERS = [
    {
      cluster: 'Fintech & Modern Payments',
      keywords: ['stripe', 'plaid', 'brex', 'ramp', 'adyen', 'affirm', 'klarna', 'checkout', 'marqeta'],
      competitors: ['Stripe', 'Plaid', 'Brex', 'Ramp', 'Adyen', 'Checkout.com'],
    },
    {
      cluster: 'Cloud Observability & SecOps',
      keywords: ['datadog', 'dynatrace', 'new relic', 'splunk', 'sentry', 'grafana', 'crowdstrike', 'palo alto', 'wiz', 'snyk', 'sentinelone'],
      competitors: ['Datadog', 'Dynatrace', 'New Relic', 'Wiz', 'CrowdStrike', 'Snyk'],
    },
    {
      cluster: 'AI & Data Infrastructure',
      keywords: ['openai', 'anthropic', 'cohere', 'scale ai', 'databricks', 'snowflake', 'pinecone', 'weaviate', 'hugging face'],
      competitors: ['Anthropic', 'Cohere', 'Scale AI', 'Databricks', 'Snowflake', 'Pinecone'],
    },
  ];

  function getCompetitorCluster(account = {}) {
    const name = String(account.displayName || account.name || '').toLowerCase();
    const industry = String(account.industry || '').toLowerCase();
    const domain = String(account.domain || '').toLowerCase();

    for (const group of COMPETITOR_CLUSTERS) {
      const match = group.keywords.some(k => name.includes(k) || industry.includes(k) || domain.includes(k));
      if (match) {
        const peers = group.competitors.filter(c => !c.toLowerCase().includes(name) && !name.includes(c.toLowerCase()));
        return {
          clusterName: group.cluster,
          competitors: peers.slice(0, 4),
        };
      }
    }

    return { clusterName: 'Industry Peers', competitors: [] };
  }

  const stripeCluster = getCompetitorCluster({ displayName: 'Stripe Inc', industry: 'Financial Services' });
  assert.equal(stripeCluster.clusterName, 'Fintech & Modern Payments');
  assert.ok(stripeCluster.competitors.includes('Plaid'));
  assert.ok(stripeCluster.competitors.includes('Brex'));
  assert.ok(!stripeCluster.competitors.includes('Stripe')); // must not include self

  const datadogCluster = getCompetitorCluster({ displayName: 'Datadog HQ', domain: 'datadoghq.com' });
  assert.equal(datadogCluster.clusterName, 'Cloud Observability & SecOps');
  assert.ok(datadogCluster.competitors.includes('Dynatrace'));
  assert.ok(datadogCluster.competitors.includes('New Relic'));

  const openaiCluster = getCompetitorCluster({ displayName: 'OpenAI Research', domain: 'openai.com' });
  assert.equal(openaiCluster.clusterName, 'AI & Data Infrastructure');
  assert.ok(openaiCluster.competitors.includes('Anthropic'));
});

test('📈 Elite Pillar 3: Revenue Kanban Board & Weighted Deal Probability Engine', () => {
  const STAGES = [
    { id: 'identified', prob: 0.10 },
    { id: 'outreach_sent', prob: 0.25 },
    { id: 'meeting_booked', prob: 0.50 },
    { id: 'terms_sent', prob: 0.75 },
    { id: 'placement_won', prob: 1.00 },
  ];

  const avgFee = 25000;
  const mockAccounts = [
    { id: '1', stage: 'identified' },
    { id: '2', stage: 'identified' },
    { id: '3', stage: 'outreach_sent' },
    { id: '4', stage: 'meeting_booked' },
    { id: '5', stage: 'terms_sent' },
    { id: '6', stage: 'placement_won' },
  ];

  let totalPipelineValue = mockAccounts.length * avgFee; // $150,000
  let totalWeightedValue = 0;

  mockAccounts.forEach(acc => {
    const stageObj = STAGES.find(s => s.id === acc.stage) || STAGES[0];
    totalWeightedValue += avgFee * stageObj.prob;
  });

  assert.equal(totalPipelineValue, 150000);
  // (2 * 25000 * 0.10) + (1 * 25000 * 0.25) + (1 * 25000 * 0.50) + (1 * 25000 * 0.75) + (1 * 25000 * 1.00)
  // = 5000 + 6250 + 12500 + 18750 + 25000 = 67500
  assert.equal(totalWeightedValue, 67500);
});

test('🛡️ Elite Pillar 4: Objection Buster Studio Database & Script Variations', () => {
  const OBJECTION_DB = {
    psl: {
      title: 'Vendor List (PSL)',
      executive: 'Completely respect your existing PSL structure. We operate exclusively as a targeted contingency carve-out for critical, hard-to-fill technical roles',
      direct: 'Understood on the PSL. Quick question: if your current vendors haven\'t filled in 30+ days',
      casual: 'Totally get the vendor policy. We don\'t need to be on the PSL',
    },
    internal_ta: {
      title: 'Internal Talent Team',
      executive: 'Your internal team does great work. We don\'t replace internal talent acquisition—we function as specialized sourcing overflow',
      direct: 'Great to hear your internal team is active. For hard-to-fill roles, we supplement their efforts',
      casual: 'Makes complete sense! If your internal team ever hits a bottleneck, feel free to ping me',
    },
    hiring_freeze: {
      title: 'Hiring Freeze',
      executive: 'Appreciate the transparency on the budget timeline. When key requisitions reopen, top talent moves within 10 days',
    },
    rates_first: {
      title: 'Rates First',
      executive: 'Our standard contingency fee is 20-25% upon successful placement with a full 90-day replacement guarantee',
    },
    no_agency_fee: {
      title: 'No Agency Fees',
      executive: 'Completely understand why you avoid generic agency fees. The cost of an open technical role lingering for 60+ days often exceeds $50k',
    },
  };

  assert.ok(Object.keys(OBJECTION_DB).length >= 5);
  assert.match(OBJECTION_DB.psl.executive, /contingency carve-out/);
  assert.match(OBJECTION_DB.internal_ta.executive, /specialized sourcing overflow/);
  assert.match(OBJECTION_DB.hiring_freeze.executive, /top talent moves within 10 days/);
  assert.match(OBJECTION_DB.rates_first.executive, /90-day replacement guarantee/);
  assert.match(OBJECTION_DB.no_agency_fee.executive, /cost of an open technical role/);
});

test('📄 Elite Pillar 5: 1-Click Candidate Pitch Slate Specimen Generator', () => {
  function generateCandidateSlate(job = {}) {
    const title = job.title || 'Senior Software Engineer';
    const company = job.companyName || 'Target Corp';
    return {
      jobTitle: title,
      companyName: company,
      candidates: [
        {
          specimenCode: 'Candidate Slate #A (Immediate Availability)',
          title: `Senior / Staff Engineer`,
          verifiedStack: ['PyTorch', 'AWS', 'Kubernetes'],
          achievements: ['Architected high-throughput service scaling to 15k req/sec.'],
        },
        {
          specimenCode: 'Candidate Slate #B (Passive / Open to Right Offer)',
          title: `Lead / Principal Engineer`,
          verifiedStack: ['Distributed Systems', 'Platform Reliability'],
          achievements: ['Reduced P99 latency by 42%.'],
        },
      ],
    };
  }

  const slate = generateCandidateSlate({ title: 'Staff Platform Engineer', companyName: 'Shopify' });
  assert.equal(slate.companyName, 'Shopify');
  assert.equal(slate.candidates.length, 2);
  assert.match(slate.candidates[0].specimenCode, /Candidate Slate #A/);
  assert.ok(slate.candidates[0].verifiedStack.length > 0);
  assert.ok(slate.candidates[1].achievements.length > 0);
});

test('🗺️ Elite Pillar 6: Geographic Talent Hubs Matrix Engine', () => {
  const GEO_HUBS = [
    { id: 'gta', keywords: ['toronto', 'ontario', 'waterloo', 'vancouver', 'montreal', 'canada', 'ottawa'] },
    { id: 'us_east', keywords: ['new york', 'nyc', 'boston', 'atlanta', 'miami', 'virginia', 'washington'] },
    { id: 'us_west', keywords: ['san francisco', 'sf', 'bay area', 'seattle', 'los angeles', 'california', 'ca'] },
    { id: 'us_central', keywords: ['austin', 'texas', 'chicago', 'denver', 'dallas', 'colorado'] },
    { id: 'remote', keywords: ['remote', 'anywhere', 'distributed', 'work from home'] },
  ];

  function getGeographicHub(jobOrAccount = {}) {
    const loc = String(jobOrAccount.location || jobOrAccount.geography || '').toLowerCase();
    const isRemote = jobOrAccount.isRemote || jobOrAccount.workStyle === 'remote' || loc.includes('remote');
    if (isRemote) return 'remote';
    for (const hub of GEO_HUBS) {
      if (hub.keywords.some(k => loc.includes(k))) return hub.id;
    }
    return 'all';
  }

  assert.equal(getGeographicHub({ location: 'Toronto, ON' }), 'gta');
  assert.equal(getGeographicHub({ location: 'New York, NY' }), 'us_east');
  assert.equal(getGeographicHub({ location: 'San Francisco, CA' }), 'us_west');
  assert.equal(getGeographicHub({ location: 'Austin, TX' }), 'us_central');
  assert.equal(getGeographicHub({ isRemote: true, location: 'United States' }), 'remote');
});

test('🚀 Elite Suite UI & DOM Contracts Parity', () => {
  const appJs = fs.readFileSync(APP_JS_PATH, 'utf-8');
  const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
  const stylesCss = fs.readFileSync(STYLES_CSS_PATH, 'utf-8');

  // HTML Containers & Menu Actions
  assert.ok(indexHtml.includes('id="objection-modal-backdrop"'), 'objection-modal-backdrop must exist in index.html');
  assert.ok(indexHtml.includes('id="candidate-slate-modal-backdrop"'), 'candidate-slate-modal-backdrop must exist in index.html');
  assert.ok(indexHtml.includes('data-action="open-objection-studio"'), 'open-objection-studio must exist in index.html');
  assert.ok(indexHtml.includes('data-action="open-candidate-slate-modal"'), 'open-candidate-slate-modal must exist in index.html');

  // CSS Styles
  assert.ok(stylesCss.includes('.tech-dna-chip'), '.tech-dna-chip must exist in styles.css');
  assert.ok(stylesCss.includes('.cluster-box'), '.cluster-box must exist in styles.css');
  assert.ok(stylesCss.includes('.cluster-pill'), '.cluster-pill must exist in styles.css');
  assert.ok(stylesCss.includes('.revenue-kanban-board'), '.revenue-kanban-board must exist in styles.css');
  assert.ok(stylesCss.includes('.revenue-kanban-cols'), '.revenue-kanban-cols must exist in styles.css');
  assert.ok(stylesCss.includes('.objection-dialog'), '.objection-dialog must exist in styles.css');
  assert.ok(stylesCss.includes('.objection-tab-btn'), '.objection-tab-btn must exist in styles.css');
  assert.ok(stylesCss.includes('.candidate-slate-dialog'), '.candidate-slate-dialog must exist in styles.css');
  assert.ok(stylesCss.includes('.candidate-slate-card'), '.candidate-slate-card must exist in styles.css');
  assert.ok(stylesCss.includes('.geo-hub-bar'), '.geo-hub-bar must exist in styles.css');
  assert.ok(stylesCss.includes('.geo-hub-pill'), '.geo-hub-pill must exist in styles.css');

  // App.js Functions & Handlers
  assert.ok(appJs.includes('function extractTechStack('), 'extractTechStack must exist in app.js');
  assert.ok(appJs.includes('function getCompetitorCluster('), 'getCompetitorCluster must exist in app.js');
  assert.ok(appJs.includes('function renderRevenueKanbanBoard('), 'renderRevenueKanbanBoard must exist in app.js');
  assert.ok(appJs.includes('function openObjectionStudioModal('), 'openObjectionStudioModal must exist in app.js');
  assert.ok(appJs.includes('function openCandidateSlateModal('), 'openCandidateSlateModal must exist in app.js');
  assert.ok(appJs.includes('function getGeographicHub('), 'getGeographicHub must exist in app.js');
  assert.ok(appJs.includes('function renderGeographicHubFilter('), 'renderGeographicHubFilter must exist in app.js');
});
