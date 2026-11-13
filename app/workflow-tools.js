/* Shared workspace judgments and personal follow-up delivery controls. */
window.bdWorkflowTools = (() => {
  let context;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function renderFeedback(item) {
    if (!context?.getBootstrap()?.capabilities?.jobFeedback) return '';
    const feedback = item.relevanceFeedback || {};
    const disabled = context.canMutate() ? '' : ' disabled';
    return `<div class="job-feedback" data-job-feedback="${esc(item.id)}" data-version="${esc(feedback.updatedAt || '')}" role="group" aria-label="Workspace feedback for ${esc(item.title)}">
      <span class="small muted">Workspace feedback</span><div class="micro-button-row">
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
    intro: 'One email a week, from Monday at or after your chosen local hour, listing roles first seen in the past seven days at companies in this workspace. It goes to your verified account email. No email is sent in a week with no new roles, and you can turn it off here at any time.',
    optIn: 'Email me a weekly digest of new roles',
    save: 'Save digest settings',
    enabled: 'Weekly digest is on. The first one covers next week.',
    off: 'Weekly digest is off. Your settings are saved.',
  };
  function renderRoleDigest() {
    if (!context?.getBootstrap()?.capabilities?.roleDigest || context.getBootstrap()?.session?.readOnly) return '';
    return `<details class="form-card workspace-disclosure" data-role-digest-tools><summary><span class="workspace-disclosure__icon" aria-hidden="true">▤</span><span><strong>Weekly email digest</strong><small>New roles at your companies, once a week</small></span></summary><div class="followup-tools-body">
      <p class="small">Get one email a week listing roles first seen at companies in this workspace. It is off unless you turn it on.</p>
      <button type="button" class="ghost-button" data-digest-open>Digest settings</button>
      <div data-digest-settings></div></div></details>`;
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
  return { init, renderFeedback, renderFollowups, renderRoleDigest, openRoleDigestFromLink };
})();
