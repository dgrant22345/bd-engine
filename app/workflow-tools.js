/* Shared workspace judgments and personal follow-up delivery controls. */
window.bdWorkflowTools = (() => {
  let context;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function renderFeedback(item) {
    if (!context?.getBootstrap()?.capabilities?.jobFeedback) return '';
    const feedback = item.relevanceFeedback || {};
    const disabled = context.canMutate() ? '' : ' disabled';
    return `<div class="job-feedback" data-job-feedback="${esc(item.id)}" data-version="${esc(feedback.updatedAt || '')}" role="group" aria-label="Workspace feedback for ${esc(item.title)}">
      <span class="visually-hidden">Workspace feedback</span><div class="micro-button-row">
      ${[['relevant', 'Relevant'], ['not_relevant', 'Not relevant']].map(([vote, label]) => `<button type="button" class="micro-button" data-job-vote="${vote}" aria-pressed="${feedback.vote === vote}"${disabled}>${label}</button>`).join('')}
      <button type="button" class="micro-button" data-job-vote=""${disabled}${feedback.vote ? '' : ' hidden'}>Clear</button></div>
      <p class="small" data-feedback-status role="status"></p>
      <a class="small" href="#/admin/search-focus" data-refine-focus${feedback.vote === 'not_relevant' ? '' : ' hidden'}>Refine excluded title phrases in saved focus</a>
    </div>`;
  }
  function renderFollowups() {
    if (!context?.getBootstrap()?.capabilities?.followupReminders) return '';
    return `<details class="form-card workspace-disclosure" data-followup-tools><summary><span class="workspace-disclosure__icon" aria-hidden="true">▦</span><span><strong>Calendar &amp; email reminders</strong><small>Export tasks and choose delivery</small></span></summary><div class="followup-tools-body">
      <p class="small">Download dated, pending follow-ups from the current search. Import the file into your calendar; it is a snapshot. Completed and undated tasks are omitted.</p>
      <button type="button" class="secondary-button" data-calendar-export>Download calendar (.ics)</button>
      <button type="button" class="ghost-button" data-reminder-open>Email reminder settings</button>
      <div data-reminder-settings></div><p data-calendar-status class="small" role="status"></p></div></details>`;
  }
  const REMINDER_INTRO = 'Receive one daily digest of dated, pending tasks due today or overdue, at or after your chosen local hour. It goes to your verified account email.';
  const REMINDER_SETTINGS = {
    endpoint: '/api/tasks/reminders',
    loading: 'Loading reminder settings…',
    unverified: 'Verify your account email before enabling reminders.',
    unconfigured: 'Email delivery needs setup. Calendar reminders are available now.',
    optIn: 'Email me daily follow-up reminders',
    save: 'Save reminder settings',
    enabled: 'Daily email reminders enabled.',
    off: 'Email reminders are off. Your settings are saved.',
  };
  const DIGEST_SETTINGS = {
    endpoint: '/api/jobs/digest',
    loading: 'Loading digest settings…',
    unverified: 'Verify your account email before turning on the weekly digest.',
    unconfigured: 'Email delivery is not set up for this workspace yet.',
    intro: 'One email a week, from Monday at or after your chosen local hour, listing roles that are new in the past seven days at companies in this workspace. It goes to your verified account email. No email is sent in a week with no new roles, and you can turn it off here at any time.',
    optIn: 'Email me a weekly digest of new roles',
    save: 'Save digest settings',
    enabled: 'Weekly digest is on. The first one covers next week.',
    off: 'Weekly digest is off. Your settings are saved.',
  };
  function renderRoleDigest() {
    if (!context?.getBootstrap()?.capabilities?.roleDigest || context.getBootstrap()?.session?.readOnly) return '';
    return `<details class="form-card workspace-disclosure" data-role-digest-tools><summary><span class="workspace-disclosure__icon" aria-hidden="true">▤</span><span><strong>Weekly email digest</strong><small>New roles at your companies, once a week</small></span></summary><div class="followup-tools-body">
      <p class="small">Get one email a week listing new roles at companies in this workspace. It is off unless you turn it on.</p>
      <button type="button" class="ghost-button" data-digest-open>Digest settings</button>
      <div data-digest-settings></div></div></details>`;
  }
  // Trial emails (welcome, add-companies reminder, trial-ending note) are on
  // for the workspace owner until they turn them off here; every email links
  // back to this card.
  function renderTrialEmails() {
    if (context?.getBootstrap()?.session?.readOnly) return '';
    return `<div class="action-card" id="trial-emails" data-trial-emails>
      <p class="eyebrow">Trial emails</p>
      <h4>Help during your trial</h4>
      <p class="small muted">Up to three emails to the workspace owner: a welcome, a reminder to add companies if there are none after three days, and a note three days before the trial ends.</p>
      <div data-trial-emails-body class="small">Loading email settings…</div>
    </div>`;
  }
  async function loadTrialEmails(root = document) {
    const body = root.querySelector('[data-trial-emails] [data-trial-emails-body]');
    if (!body) return;
    try {
      const data = await context.api('/api/account/trial-emails', { skipCache: true });
      if (!body.isConnected) return;
      if (!data.owner) { body.textContent = 'Trial emails go to the workspace owner.'; return; }
      const note = !data.providerConfigured ? 'Email delivery is not set up yet, so none are sent.' : !data.emailVerified ? 'Verify your account email to receive them.' : '';
      body.innerHTML = `<label class="reminder-optin"><input type="checkbox" data-trial-emails-toggle${data.optedOut ? '' : ' checked'}${context.canMutate() ? '' : ' disabled'}> Send me trial emails</label>
        <p class="small" role="status" data-trial-emails-status>${esc(note)}</p>`;
      const toggle = body.querySelector('[data-trial-emails-toggle]');
      const status = body.querySelector('[data-trial-emails-status]');
      toggle.onchange = async () => {
        toggle.disabled = true;
        try {
          const saved = await context.api('/api/account/trial-emails', { method: 'PUT', body: JSON.stringify({ version: data.version, optedOut: !toggle.checked }) });
          data.version = saved.version;
          status.textContent = saved.optedOut ? 'Trial emails are off.' : 'Trial emails are on.';
        } catch (error) {
          toggle.checked = !toggle.checked;
          status.textContent = error.message || 'Settings could not be saved. Try again.';
        } finally { toggle.disabled = !context.canMutate(); }
      };
    } catch (error) { if (body.isConnected) body.textContent = error.message || 'Email settings could not be loaded.'; }
  }
  // Team: the people who share this workspace, invitations and roles.
  const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };
  function renderTeam() {
    if (context?.getBootstrap()?.session?.readOnly) return '<p class="small muted">Invite teammates from your own workspace after you start a trial.</p>';
    return `<div class="team-panel" data-team><div data-team-body class="small">Loading your team…</div></div>`;
  }
  function seatsText(seats) {
    const pending = seats.pending ? ` · ${seats.pending} invitation${seats.pending === 1 ? '' : 's'} pending` : '';
    if (seats.limit === 'unlimited') return `${seats.members} ${seats.members === 1 ? 'person' : 'people'} in this workspace${pending}`;
    return `${seats.members} of ${seats.limit} ${seats.limit === 1 ? 'seat' : 'seats'} used${pending}`;
  }
  function canRemove(data, member) {
    if (member.role === 'owner') return false;
    if (member.you) return true;
    return data.role === 'owner' || (data.role === 'admin' && member.role === 'member');
  }
  function expiresText(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : `Expires ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }
  async function loadTeam(root = document) {
    const body = root.querySelector('[data-team] [data-team-body]');
    if (!body) return;
    const draw = (data, message = '', link = null) => {
      if (!body.isConnected) return;
      const full = data.seats.available !== null && data.seats.available < 1;
      const writable = context.canMutate();
      const oneSeat = data.seats.limit === 1;
      body.innerHTML = `
        <p class="team-seats"><strong>${esc(seatsText(data.seats))}</strong>${oneSeat ? '<span class="muted"> · Recruiter Pro and the free trial include up to 3 users.</span>' : ''}</p>
        <ul class="team-list" aria-label="People in this workspace">
          ${data.members.map((member) => {
            const name = member.name || member.email;
            const role = data.role === 'owner' && member.role !== 'owner' && !member.you && writable
              ? `<select data-team-role="${esc(member.userId)}" aria-label="Role for ${esc(name)}">${['member', 'admin'].map((value) => `<option value="${value}"${member.role === value ? ' selected' : ''}>${ROLE_LABELS[value]}</option>`).join('')}</select>`
              : `<span class="team-role-badge team-role-badge--${esc(member.role)}">${esc(ROLE_LABELS[member.role] || member.role)}</span>`;
            const action = canRemove(data, member) && writable
              ? `<button type="button" class="ghost-button team-remove" data-team-remove="${esc(member.userId)}" data-team-name="${esc(name)}" data-team-self="${member.you ? '1' : ''}">${member.you ? 'Leave workspace' : 'Remove'}</button>`
              : '';
            return `<li class="team-row">
              <span class="team-avatar" aria-hidden="true">${esc(name.charAt(0).toUpperCase())}</span>
              <span class="team-person"><strong>${esc(name)}${member.you ? ' <span class="muted">(you)</span>' : ''}</strong><span class="muted">${esc(member.email)}</span></span>
              <span class="team-role">${role}</span>
              <span class="team-actions">${action}</span>
            </li>`;
          }).join('')}
        </ul>
        ${data.canManage ? `
          ${data.invitations.length ? `<h4 class="team-subhead">Pending invitations</h4>
          <ul class="team-list" aria-label="Pending invitations">
            ${data.invitations.map((item) => `<li class="team-row team-row--pending">
              <span class="team-avatar team-avatar--pending" aria-hidden="true">@</span>
              <span class="team-person"><strong>${esc(item.email)}</strong><span class="muted">${esc(ROLE_LABELS[item.role] || item.role)} · ${esc(expiresText(item.expiresAt))}</span></span>
              <span class="team-role"></span>
              <span class="team-actions">${writable && (data.role === 'owner' || item.role === 'member') ? `<button type="button" class="ghost-button" data-team-withdraw="${esc(item.id)}">Withdraw</button>` : ''}</span>
            </li>`).join('')}
          </ul>` : ''}
          <form class="team-invite" data-team-invite novalidate>
            <label class="team-field"><span>Invite by email</span><input type="email" name="email" required autocomplete="off" maxlength="254" placeholder="teammate@company.com"${full || !writable ? ' disabled' : ''}></label>
            <label class="team-field"><span>Role</span><select name="role"${full || !writable ? ' disabled' : ''}><option value="member">Member</option>${data.canInviteAdmins ? '<option value="admin">Admin</option>' : ''}</select></label>
            <button class="primary-button" type="submit"${full || !writable ? ' disabled' : ''}>Send invitation</button>
          </form>
          ${full ? '<p class="small muted">Every seat is in use. Withdraw an invitation or remove someone to invite another person.</p>' : ''}
          <p class="small muted">Everyone shares the workspace's companies, people, open roles and outreach. Admins can also invite and remove members and manage billing. Only the owner can change roles or delete the workspace.</p>
        ` : '<p class="small muted">The workspace owner and admins invite people and manage the team.</p>'}
        <div class="team-status" role="status" data-team-status>${message ? esc(message) : ''}${link ? `<div class="team-link"><input readonly value="${esc(link)}" aria-label="Invitation link"><button type="button" class="secondary-button" data-team-copy>Copy link</button></div>` : ''}</div>`;
      wire(data);
    };
    const refresh = async (message = '', link = null) => draw(await context.api('/api/team', { skipCache: true }), message, link);
    const fail = (error) => {
      const status = body.querySelector('[data-team-status]');
      if (status) status.textContent = error.message || 'That did not work. Please try again.';
    };
    const wire = (data) => {
      const form = body.querySelector('[data-team-invite]');
      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const fields = new FormData(form);
        const email = String(fields.get('email') || '').trim();
        const status = body.querySelector('[data-team-status]');
        if (!form.elements.email.checkValidity() || !email) { status.textContent = 'Enter a valid email address.'; form.elements.email.focus(); return; }
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        status.textContent = 'Sending the invitation…';
        try {
          const sent = await context.api('/api/team/invitations', { method: 'POST', body: JSON.stringify({ email, role: fields.get('role') || 'member' }) });
          await refresh(sent.emailSent
            ? `Invitation sent to ${sent.invitation.email}. The link works once and expires in 7 days.`
            : `Email is not set up here, so no email was sent. Share this link with ${sent.invitation.email}:`, sent.acceptUrl || null);
        } catch (error) { button.disabled = false; fail(error); }
      });
      body.querySelector('[data-team-copy]')?.addEventListener('click', async (event) => {
        const input = body.querySelector('.team-link input');
        try { await navigator.clipboard.writeText(input.value); event.target.textContent = 'Copied'; } catch { input.select(); }
      });
      body.querySelectorAll('[data-team-role]').forEach((select) => select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          const saved = await context.api(`/api/team/members/${encodeURIComponent(select.dataset.teamRole)}`, { method: 'PATCH', body: JSON.stringify({ role: select.value }) });
          await refresh(`${saved.member.name || saved.member.email} is now ${saved.member.role === 'admin' ? 'an admin' : 'a member'}.`);
        } catch (error) { await refresh().catch(() => {}); fail(error); }
      }));
      body.querySelectorAll('[data-team-withdraw]').forEach((button) => button.addEventListener('click', async () => {
        button.disabled = true;
        try { await context.api(`/api/team/invitations/${encodeURIComponent(button.dataset.teamWithdraw)}`, { method: 'DELETE' }); await refresh('Invitation withdrawn. Its link no longer works.'); }
        catch (error) { button.disabled = false; fail(error); }
      }));
      // Two steps: the first click asks, the second removes.
      body.querySelectorAll('[data-team-remove]').forEach((button) => button.addEventListener('click', async () => {
        const self = button.dataset.teamSelf === '1';
        if (button.dataset.confirming !== '1') {
          button.dataset.confirming = '1';
          button.classList.add('team-remove--confirm');
          button.textContent = self ? 'Confirm: leave' : `Confirm: remove ${button.dataset.teamName}`;
          setTimeout(() => { if (button.isConnected && button.dataset.confirming === '1') { button.dataset.confirming = ''; button.classList.remove('team-remove--confirm'); button.textContent = self ? 'Leave workspace' : 'Remove'; } }, 6000);
          return;
        }
        button.disabled = true;
        try {
          const result = await context.api(`/api/team/members/${encodeURIComponent(button.dataset.teamRemove)}`, { method: 'DELETE' });
          if (result.left) { window.top.location.replace('/'); return; }
          await refresh(`${button.dataset.teamName} was removed from this workspace.`);
        } catch (error) { button.disabled = false; fail(error); }
      }));
    };
    try { await refresh(); } catch (error) { if (body.isConnected) body.textContent = error.message || 'Your team could not be loaded.'; }
  }
  async function openReminders(container, config = REMINDER_SETTINGS) {
    container.textContent = config.loading;
    try {
      const data = await context.api(config.endpoint, { skipCache: true });
      if (!container.isConnected) return;
      const timezone = data.version ? data.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone;
      const eligible = data.providerConfigured && data.emailVerified && context.canMutate();
      container.innerHTML = `<form data-reminder-form class="task-create-form">
        <p class="small">${!data.providerConfigured ? config.unconfigured : !data.emailVerified ? config.unverified : esc(config.intro || REMINDER_INTRO)}</p>
        <label class="reminder-optin"><input type="checkbox" name="emailEnabled"${data.emailEnabled ? ' checked' : ''}${eligible || data.emailEnabled ? '' : ' disabled'}> ${config.optIn}</label>
        <label>Time zone<input name="timezone" value="${esc(timezone)}" required maxlength="100" placeholder="America/Toronto"></label>
        <label>Local hour<select name="hour">${Array.from({ length: 24 }, (_, hour) => `<option value="${hour}"${data.hour === hour ? ' selected' : ''}>${String(hour).padStart(2, '0')}:00</option>`).join('')}</select></label>
        <button type="submit" class="primary-button"${context.canMutate() ? '' : ' disabled'}>${config.save}</button><p class="small" role="status" data-reminder-status></p></form>`;
      const form = container.querySelector('form');
      form.onsubmit = async event => {
        event.preventDefault(); const status = form.querySelector('[data-reminder-status]'); const button = form.querySelector('button'); button.disabled = true;
        try {
          const fields = new FormData(form);
          const saved = await context.api(config.endpoint, { method: 'PUT', body: JSON.stringify({ version: data.version, emailEnabled: fields.has('emailEnabled'), timezone: fields.get('timezone'), hour: Number(fields.get('hour')) }) });
          data.version = saved.version;
          status.textContent = saved.emailEnabled ? config.enabled : config.off;
        } catch (error) { status.textContent = error.message || 'Settings could not be saved. Try again.'; }
        finally { button.disabled = false; }
      };
    } catch (error) { container.textContent = error.message || 'Settings could not be loaded. Try again.'; }
  }
  function init(options) {
    context = options;
    document.addEventListener('click', async event => {
      const voteButton = event.target.closest('[data-job-vote]');
      if (voteButton) {
        const container = voteButton.closest('[data-job-feedback]'); const buttons = [...container.querySelectorAll('button')];
        const status = container.querySelector('[data-feedback-status]');
        buttons.forEach(button => { button.disabled = true; });
        try {
          const saved = await context.api(`/api/jobs/${encodeURIComponent(container.dataset.jobFeedback)}/feedback`, { method: 'PATCH', body: JSON.stringify({ vote: voteButton.dataset.jobVote, expectedUpdatedAt: container.dataset.version }) });
          context.updateJob(saved); if (!container.isConnected) return;
          container.dataset.version = saved.relevanceFeedback.updatedAt;
          buttons.forEach(button => { button.setAttribute('aria-pressed', String(Boolean(button.dataset.jobVote) && button.dataset.jobVote === saved.relevanceFeedback.vote)); if (!button.dataset.jobVote) button.hidden = !saved.relevanceFeedback.vote; });
          container.querySelector('[data-refine-focus]').hidden = saved.relevanceFeedback.vote !== 'not_relevant';
          status.textContent = 'Workspace feedback saved.';
        } catch (error) { if (container.isConnected) status.textContent = error.message || 'Feedback could not be saved. Try again.'; }
        finally { buttons.forEach(button => { button.disabled = !context.canMutate(); }); }
      }
      const settingsButton = event.target.closest('[data-reminder-open]');
      if (settingsButton) await openReminders(settingsButton.closest('[data-followup-tools]').querySelector('[data-reminder-settings]'));
      const digestButton = event.target.closest('[data-digest-open]');
      if (digestButton) await openReminders(digestButton.closest('[data-role-digest-tools]').querySelector('[data-digest-settings]'), DIGEST_SETTINGS);
      const calendarButton = event.target.closest('[data-calendar-export]');
      if (calendarButton) {
        const status = calendarButton.closest('[data-followup-tools]').querySelector('[data-calendar-status]'); calendarButton.disabled = true;
        try {
          const query = new URLSearchParams(context.getTaskQuery());
          const response = await fetch(`/api/tasks/calendar?${query}`, { credentials: 'same-origin' });
          if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || 'Calendar could not be downloaded. Try again.'); }
          const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = 'bd-engine-followups.ics'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
          status.textContent = 'Calendar downloaded. Import it into your calendar app to see dated follow-ups.';
        } catch (error) { status.textContent = error.message; }
        finally { calendarButton.disabled = false; }
      }
    });
  }
  // Opens the digest settings when the page was reached from the email's
  // "Turn it off" link (#/jobs?digest=settings).
  function openRoleDigestFromLink(root = document) {
    const tools = root.querySelector('[data-role-digest-tools]');
    if (!tools || new URLSearchParams(location.hash.split('?')[1] || '').get('digest') !== 'settings') return;
    tools.open = true;
    tools.scrollIntoView({ block: 'center' });
    void openReminders(tools.querySelector('[data-digest-settings]'), DIGEST_SETTINGS);
  }
  return { init, renderFeedback, renderFollowups, renderRoleDigest, openRoleDigestFromLink, renderTrialEmails, loadTrialEmails, renderTeam, loadTeam };
})();
