const now = () => new Date().toISOString();

const seedTenant = {
  id: 'tenant-demo',
  slug: 'demo',
  name: 'Demo Staffing Co',
  plan: 'trial',
  status: 'trialing',
};

const seedUser = {
  id: 'user-demo',
  email: 'founder@example.com',
  name: 'BD Engine Founder',
};

const accounts = [
  {
    id: 'acct-northstar',
    tenantId: seedTenant.id,
    displayName: 'Northstar Robotics',
    normalizedName: 'northstar robotics',
    domain: 'northstar.example',
    industry: 'Industrial automation',
    location: 'Toronto, ON',
    status: 'contacted',
    outreachStatus: 'contacted',
    targetScore: 91,
    openRoleCount: 14,
    nextAction: 'Follow up with Priya Shah',
    nextActionAt: futureDate(4),
    notes: 'High hiring velocity across controls and embedded roles.',
  },
  {
    id: 'acct-vertex',
    tenantId: seedTenant.id,
    displayName: 'Vertex Health Systems',
    normalizedName: 'vertex health systems',
    domain: 'vertexhealth.example',
    industry: 'Health technology',
    location: 'Boston, MA',
    status: 'ready',
    outreachStatus: 'ready_to_contact',
    targetScore: 84,
    openRoleCount: 8,
    nextAction: 'Draft VP Talent outreach',
    nextActionAt: futureDate(1),
    notes: 'New product hiring with several data engineering openings.',
  },
  {
    id: 'acct-lumen',
    tenantId: seedTenant.id,
    displayName: 'LumenGrid Energy',
    normalizedName: 'lumengrid energy',
    domain: 'lumengrid.example',
    industry: 'Clean energy',
    location: 'Denver, CO',
    status: 'new',
    outreachStatus: 'not_started',
    targetScore: 78,
    openRoleCount: 5,
    nextAction: 'Find talent leader',
    nextActionAt: futureDate(7),
    notes: 'Active hiring for grid software and project delivery.',
  },
];

const contacts = [
  {
    id: 'ct-priya',
    tenantId: seedTenant.id,
    accountId: 'acct-northstar',
    fullName: 'Priya Shah',
    firstName: 'Priya',
    lastName: 'Shah',
    email: 'priya.shah@example.com',
    linkedinUrl: 'https://www.linkedin.com/in/priya-shah',
    companyName: 'Northstar Robotics',
    title: 'Director of Talent',
    connectedOn: '2025-11-18',
    outreachStatus: 'contacted',
    priorityScore: 93,
    notes: 'Warm fit for recruiting delivery conversation.',
  },
  {
    id: 'ct-marcus',
    tenantId: seedTenant.id,
    accountId: 'acct-vertex',
    fullName: 'Marcus Lee',
    firstName: 'Marcus',
    lastName: 'Lee',
    email: 'marcus.lee@example.com',
    linkedinUrl: 'https://www.linkedin.com/in/marcus-lee',
    companyName: 'Vertex Health Systems',
    title: 'VP People',
    connectedOn: '2026-01-09',
    outreachStatus: 'ready_to_contact',
    priorityScore: 88,
    notes: '',
  },
  {
    id: 'ct-amara',
    tenantId: seedTenant.id,
    accountId: 'acct-lumen',
    fullName: 'Amara Patel',
    firstName: 'Amara',
    lastName: 'Patel',
    email: '',
    linkedinUrl: 'https://www.linkedin.com/in/amara-patel',
    companyName: 'LumenGrid Energy',
    title: 'Head of Engineering',
    connectedOn: '2025-09-04',
    outreachStatus: 'not_started',
    priorityScore: 81,
    notes: 'Technical buyer angle.',
  },
];

const jobs = [
  {
    id: 'job-controls',
    tenantId: seedTenant.id,
    accountId: 'acct-northstar',
    title: 'Senior Controls Engineer',
    companyName: 'Northstar Robotics',
    location: 'Toronto, ON',
    source: 'Greenhouse',
    postedAt: pastDate(2),
    active: true,
  },
  {
    id: 'job-embedded',
    tenantId: seedTenant.id,
    accountId: 'acct-northstar',
    title: 'Embedded Software Engineer',
    companyName: 'Northstar Robotics',
    location: 'Remote Canada',
    source: 'Greenhouse',
    postedAt: pastDate(5),
    active: true,
  },
  {
    id: 'job-data',
    tenantId: seedTenant.id,
    accountId: 'acct-vertex',
    title: 'Data Platform Engineer',
    companyName: 'Vertex Health Systems',
    location: 'Boston, MA',
    source: 'Lever',
    postedAt: pastDate(1),
    active: true,
  },
  {
    id: 'job-grid',
    tenantId: seedTenant.id,
    accountId: 'acct-lumen',
    title: 'Grid Software Program Manager',
    companyName: 'LumenGrid Energy',
    location: 'Denver, CO',
    source: 'Ashby',
    postedAt: pastDate(9),
    active: true,
  },
];

const activities = [
  {
    id: 'act-seed',
    tenantId: seedTenant.id,
    accountId: 'acct-northstar',
    contactId: 'ct-priya',
    type: 'outreach',
    summary: 'Sent email + LinkedIn outreach to Priya Shah',
    notes: 'Manual seed activity for the SaaS prototype.',
    occurredAt: pastDate(3),
    metadata: { channels: ['email', 'linkedin'] },
  },
];

const followups = [
  {
    id: 'fu-priya',
    tenantId: seedTenant.id,
    accountId: 'acct-northstar',
    contactId: 'ct-priya',
    dueAt: `${futureDate(4)}T09:00:00.000Z`,
    status: 'open',
    note: 'Follow up with Priya Shah after email + LinkedIn outreach',
  },
];

export function createStore() {
  return {
    getSession() {
      return {
        tenant: { ...seedTenant },
        user: { ...seedUser },
        membership: { role: 'owner' },
      };
    },

    getBootstrap(tenantId) {
      assertTenant(tenantId);
      const tenantAccounts = accountsForTenant(tenantId);
      const tenantContacts = contactsForTenant(tenantId);
      const tenantJobs = jobsForTenant(tenantId);
      const openFollowups = followups.filter((item) => item.tenantId === tenantId && item.status === 'open');
      return {
        summary: {
          accountCount: tenantAccounts.length,
          contactCount: tenantContacts.length,
          openRoleCount: tenantJobs.filter((job) => job.active).length,
          followupCount: openFollowups.length,
          averageTargetScore: Math.round(tenantAccounts.reduce((sum, item) => sum + item.targetScore, 0) / Math.max(tenantAccounts.length, 1)),
        },
        accounts: tenantAccounts,
        contacts: tenantContacts,
        jobs: tenantJobs,
        activity: activities
          .filter((item) => item.tenantId === tenantId)
          .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt))),
        followups: openFollowups.sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt))),
      };
    },

    getAccounts(tenantId) {
      assertTenant(tenantId);
      return accountsForTenant(tenantId);
    },

    getContacts(tenantId) {
      assertTenant(tenantId);
      return contactsForTenant(tenantId);
    },

    createOutreachDraft(tenantId, contactId) {
      assertTenant(tenantId);
      const contact = contacts.find((item) => item.tenantId === tenantId && item.id === contactId);
      if (!contact) return null;
      const account = accounts.find((item) => item.tenantId === tenantId && item.id === contact.accountId);
      const accountJobs = jobs.filter((item) => item.tenantId === tenantId && item.accountId === contact.accountId && item.active);
      return buildDraft({ account, contact, jobs: accountJobs });
    },

    logOutreach(tenantId, userId, payload) {
      assertTenant(tenantId);
      const contact = contacts.find((item) => item.tenantId === tenantId && item.id === payload.contactId);
      if (!contact) return null;
      const account = accounts.find((item) => item.tenantId === tenantId && item.id === contact.accountId);
      if (!account) return null;

      const followUpDate = futureDate(7);
      const activity = {
        id: `act-${Date.now()}`,
        tenantId,
        accountId: account.id,
        contactId: contact.id,
        type: 'outreach',
        summary: `Sent email + LinkedIn outreach to ${contact.fullName}`,
        notes: payload.notes || '',
        occurredAt: now(),
        createdByUserId: userId,
        metadata: {
          channels: ['email', 'linkedin'],
          subjectLine: payload.subjectLine || '',
          followUpAt: followUpDate,
        },
      };
      activities.unshift(activity);

      const followup = {
        id: `fu-${Date.now()}`,
        tenantId,
        accountId: account.id,
        contactId: contact.id,
        dueAt: `${followUpDate}T09:00:00.000Z`,
        status: 'open',
        note: `Follow up with ${contact.fullName} after email + LinkedIn outreach`,
        createdByUserId: userId,
      };
      followups.push(followup);

      contact.outreachStatus = 'contacted';
      contact.notes = [contact.notes, `Outreach logged ${new Date().toISOString().slice(0, 10)}. Follow up ${followUpDate}.`]
        .filter(Boolean)
        .join('\n');
      account.outreachStatus = 'contacted';
      account.status = account.status === 'new' || account.status === 'ready' ? 'contacted' : account.status;
      account.nextAction = `Follow up with ${contact.fullName}`;
      account.nextActionAt = followUpDate;

      return { activity, followup, account, contact };
    },
  };
}

function accountsForTenant(tenantId) {
  return accounts
    .filter((item) => item.tenantId === tenantId)
    .sort((a, b) => b.targetScore - a.targetScore);
}

function contactsForTenant(tenantId) {
  return contacts
    .filter((item) => item.tenantId === tenantId)
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

function jobsForTenant(tenantId) {
  return jobs
    .filter((item) => item.tenantId === tenantId)
    .sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)));
}

function assertTenant(tenantId) {
  if (tenantId !== seedTenant.id) {
    const error = new Error('Tenant not found');
    error.status = 404;
    throw error;
  }
}

function buildDraft({ account, contact, jobs }) {
  const roleList = jobs.slice(0, 3).map((job) => job.title).join(', ');
  const openRoleLine = jobs.length
    ? `${account.displayName} has ${jobs.length} active roles showing up, including ${roleList}.`
    : `${account.displayName} has recent hiring movement worth watching.`;
  const firstName = contact.firstName || contact.fullName.split(' ')[0] || 'there';
  const subjectLine = `${account.displayName} hiring signal`;
  const emailBody = [
    `Hi ${firstName},`,
    '',
    `${openRoleLine} I help recruiting and talent teams turn that kind of hiring demand into a cleaner shortlist of candidates and warmer outreach.`,
    '',
    `Given your role as ${contact.title || 'a leader on the team'}, I thought it may be useful to compare notes on where bandwidth is tight and which searches need outside help.`,
    '',
    'Open to a quick conversation next week?',
  ].join('\n');
  const linkedinMessage = [
    `Hi ${firstName}, noticed ${account.displayName} is hiring across ${jobs.length ? roleList : 'a few priority roles'}.`,
    'I help teams prioritize recruiting outreach around live hiring signals.',
    'Worth comparing notes?'
  ].join(' ');

  return {
    contactId: contact.id,
    accountId: account.id,
    subjectLine,
    emailBody,
    linkedinMessage,
    followUpMessage: `Hi ${firstName}, circling back on my note about ${account.displayName}'s hiring priorities. Worth a quick chat?`,
    sourceSignals: {
      account: account.displayName,
      openRoleCount: jobs.length,
      roles: jobs.map((job) => job.title),
    },
  };
}

function futureDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function pastDate(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}
