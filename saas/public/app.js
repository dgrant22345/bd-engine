const state = {
  bootstrap: null,
  activeDraft: null,
};

const els = {
  summary: document.getElementById('summary-grid'),
  tenantName: document.getElementById('tenant-name'),
  tenantPlan: document.getElementById('tenant-plan'),
  accounts: document.getElementById('accounts'),
  contacts: document.getElementById('contacts-table'),
  activity: document.getElementById('activity'),
  followups: document.getElementById('followups'),
  modal: document.getElementById('outreach-modal'),
  draftBody: document.getElementById('draft-body'),
  toast: document.getElementById('toast'),
};

document.getElementById('refresh-button')?.addEventListener('click', () => loadBootstrap());
document.getElementById('close-modal')?.addEventListener('click', closeModal);
els.modal?.addEventListener('click', (event) => {
  if (event.target === els.modal) closeModal();
});

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]');
  if (!action) return;

  if (action.dataset.action === 'draft-outreach') {
    await draftOutreach(action.dataset.contactId, action);
    return;
  }

  if (action.dataset.action === 'copy-draft') {
    await navigator.clipboard.writeText(getDraftText(action.dataset.kind));
    showToast('Copied.');
    return;
  }

  if (action.dataset.action === 'log-outreach') {
    await logOutreach(action.dataset.contactId, action);
  }
});

loadBootstrap();

async function loadBootstrap() {
  const data = await api('/api/bootstrap');
  state.bootstrap = data;
  render(data);
}

function render(model) {
  const { session, data } = model;
  els.tenantName.textContent = session.tenant.name;
  els.tenantPlan.textContent = session.tenant.plan;

  els.summary.innerHTML = [
    metric('Accounts', data.summary.accountCount),
    metric('Contacts', data.summary.contactCount),
    metric('Open roles', data.summary.openRoleCount),
    metric('Follow-ups', data.summary.followupCount),
  ].join('');

  els.accounts.innerHTML = `
    <div class="account-list">
      ${data.accounts.map(renderAccountRow).join('')}
    </div>
  `;

  els.contacts.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Contact</th><th>Company</th><th>Title</th><th>Score</th><th>Status</th><th>Action</th></tr>
        </thead>
        <tbody>${data.contacts.map(renderContactRow).join('')}</tbody>
      </table>
    </div>
  `;

  els.followups.innerHTML = data.followups.length
    ? `<div class="followup-list">${data.followups.map(renderFollowupRow).join('')}</div>`
    : '<p class="muted">No follow-ups due.</p>';

  els.activity.innerHTML = data.activity.length
    ? `<div class="activity-list">${data.activity.map(renderActivityRow).join('')}</div>`
    : '<p class="muted">No activity logged yet.</p>';
}

function metric(label, value) {
  return `<article class="metric"><span class="muted">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function renderAccountRow(account) {
  return `
    <article class="account-row">
      <div>
        <strong>${escapeHtml(account.displayName)}</strong>
        <div class="muted">${escapeHtml(account.industry || '')} ${account.location ? `- ${escapeHtml(account.location)}` : ''}</div>
      </div>
      <div><span class="score">${account.targetScore}</span><div class="muted">score</div></div>
      <div><strong>${account.openRoleCount}</strong><div class="muted">open roles</div></div>
      <div><strong>${escapeHtml(account.nextActionAt || 'None')}</strong><div class="muted">${escapeHtml(account.nextAction || 'No next action')}</div></div>
    </article>
  `;
}

function renderContactRow(contact) {
  return `
    <tr>
      <td><strong>${escapeHtml(contact.fullName)}</strong><div class="muted">${contact.email ? escapeHtml(contact.email) : 'No email'}</div></td>
      <td>${escapeHtml(contact.companyName || '')}</td>
      <td>${escapeHtml(contact.title || '')}</td>
      <td>${contact.priorityScore}</td>
      <td><span class="pill">${escapeHtml(contact.outreachStatus || 'not_started')}</span></td>
      <td><button class="primary-button" type="button" data-action="draft-outreach" data-contact-id="${escapeAttr(contact.id)}">Draft outreach</button></td>
    </tr>
  `;
}

function renderFollowupRow(item) {
  return `
    <article class="followup-row">
      <strong>${escapeHtml(new Date(item.dueAt).toLocaleDateString())}</strong>
      <span>${escapeHtml(item.note)}</span>
    </article>
  `;
}

function renderActivityRow(item) {
  return `
    <article class="activity-row">
      <strong>${escapeHtml(item.summary)}</strong>
      <span class="muted">${escapeHtml(new Date(item.occurredAt).toLocaleString())}</span>
    </article>
  `;
}

async function draftOutreach(contactId, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Drafting...';
  try {
    const draft = await api(`/api/contacts/${encodeURIComponent(contactId)}/outreach-draft`, { method: 'POST' });
    state.activeDraft = draft;
    els.draftBody.innerHTML = renderDraft(draft);
    els.modal.classList.remove('hidden');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function renderDraft(draft) {
  return `
    <div class="draft-grid">
      <article class="draft-piece">
        <strong>Email</strong>
        <p class="muted">Subject: ${escapeHtml(draft.subjectLine)}</p>
        <pre>${escapeHtml(draft.emailBody)}</pre>
        <div class="button-row">
          <button class="secondary-button" data-action="copy-draft" data-kind="email" type="button">Copy email</button>
        </div>
      </article>
      <article class="draft-piece">
        <strong>LinkedIn</strong>
        <pre>${escapeHtml(draft.linkedinMessage)}</pre>
        <div class="button-row">
          <button class="secondary-button" data-action="copy-draft" data-kind="linkedin" type="button">Copy LinkedIn</button>
        </div>
      </article>
      <article class="draft-piece">
        <strong>Follow-up</strong>
        <pre>${escapeHtml(draft.followUpMessage)}</pre>
        <div class="button-row">
          <button class="primary-button" data-action="log-outreach" data-contact-id="${escapeAttr(draft.contactId)}" type="button">Log sent + one-week follow-up</button>
        </div>
      </article>
    </div>
  `;
}

async function logOutreach(contactId, button) {
  const draft = state.activeDraft;
  if (!draft) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Logging...';
  try {
    await api(`/api/contacts/${encodeURIComponent(contactId)}/log-outreach`, {
      method: 'POST',
      body: JSON.stringify({
        subjectLine: draft.subjectLine,
        notes: `Email draft:\n${draft.emailBody}\n\nLinkedIn draft:\n${draft.linkedinMessage}`,
      }),
    });
    closeModal();
    showToast('Outreach logged and follow-up created.');
    await loadBootstrap();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function getDraftText(kind) {
  const draft = state.activeDraft;
  if (!draft) return '';
  if (kind === 'linkedin') return draft.linkedinMessage || '';
  return `Subject: ${draft.subjectLine}\n\n${draft.emailBody}`.trim();
}

function closeModal() {
  els.modal.classList.add('hidden');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(body?.error || `Request failed: ${response.status}`);
  }
  return body;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('visible');
  setTimeout(() => els.toast.classList.remove('visible'), 2200);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
