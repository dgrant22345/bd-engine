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
  async function openReminders(container) {
    container.textContent = 'Loading reminder settings…';
    try {
      const data = await context.api('/api/tasks/reminders', { skipCache: true });
      if (!container.isConnected) return;
      const timezone = data.version ? data.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone;
      const eligible = data.providerConfigured && data.emailVerified && context.canMutate();
      container.innerHTML = `<form data-reminder-form class="task-create-form">
        <p class="small">${!data.providerConfigured ? 'Email delivery needs setup. Calendar reminders are available now.' : !data.emailVerified ? 'Verify your account email before enabling reminders.' : 'Receive one daily digest of dated, pending tasks due today or overdue, at or after your chosen local hour. It goes to your verified account email.'}</p>
        <label class="reminder-optin"><input type="checkbox" name="emailEnabled"${data.emailEnabled ? ' checked' : ''}${eligible || data.emailEnabled ? '' : ' disabled'}> Email me daily follow-up reminders</label>
        <label>Time zone<input name="timezone" value="${esc(timezone)}" required maxlength="100" placeholder="America/Toronto"></label>
        <label>Local hour<select name="hour">${Array.from({ length: 24 }, (_, hour) => `<option value="${hour}"${data.hour === hour ? ' selected' : ''}>${String(hour).padStart(2, '0')}:00</option>`).join('')}</select></label>
        <button type="submit" class="primary-button"${context.canMutate() ? '' : ' disabled'}>Save reminder settings</button><p class="small" role="status" data-reminder-status></p></form>`;
      const form = container.querySelector('form');
      form.onsubmit = async event => {
        event.preventDefault(); const status = form.querySelector('[data-reminder-status]'); const button = form.querySelector('button'); button.disabled = true;
        try {
          const fields = new FormData(form);
          const saved = await context.api('/api/tasks/reminders', { method: 'PUT', body: JSON.stringify({ version: data.version, emailEnabled: fields.has('emailEnabled'), timezone: fields.get('timezone'), hour: Number(fields.get('hour')) }) });
          data.version = saved.version;
          status.textContent = saved.emailEnabled ? 'Daily email reminders enabled.' : 'Email reminders are off. Your settings are saved.';
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
  return { init, renderFeedback, renderFollowups };
})();
