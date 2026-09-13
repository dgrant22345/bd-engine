/* People master-detail workspace. Deliberately framework-free and API-scoped.
 * Imported facts are not candidate assessments. Drafts are never sent here.
 */
(() => {
  const stages = { not_started: 'Not started', researching: 'Researching', ready_to_contact: 'Ready to contact', contacted: 'Contacted', replied: 'Replied', opportunity: 'Opportunity' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const safeUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
  const label = value => stages[value] || 'Not started';
  const date = value => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Not provided';
  const options = (items, value) => Object.entries(items).map(([key, text]) => `<option value="${escape(key)}"${key === value ? ' selected' : ''}>${escape(text)}</option>`).join('');
  const field = (name, title, control) => `<div class="people-field"><label for="person-${name}">${escape(title)}</label>${control}</div>`;
  const button = (action, text, extra = '') => `<button type="button" class="secondary-button" data-people="${action}" ${extra}>${text}</button>`;
  const profileLink = person => safeUrl(person.linkedinUrl) ? `<a class="secondary-button" href="${escape(safeUrl(person.linkedinUrl))}" target="_blank" rel="noreferrer">Open profile ↗</a>` : '<span class="muted small">No profile link saved</span>';

  function create({ root, api, setTitle, onQuery, exportOptions, onUpdated }) {
    const state = { result: null, key: '', query: {}, selected: '', person: null, checked: new Set(), dirty: false, busy: false, sequence: 0, scroll: 0, notice: '', dialog: null };
    let lastHash = location.hash;
    let returnFocus = null;
    let savedFormValues = {};
    let savedDraft = null;
    let savedDraftText = '';
    const updateDirty = () => { state.dirty = Boolean(root.querySelector('#person-draft') && root.querySelector('#person-draft').value !== savedDraftText) || [...(root.querySelector('.person-edit-form')?.elements || [])].some(input => input.name && input.value !== savedFormValues[input.name]); };
    const hasAddDraft = () => Boolean(state.dialog?.querySelector('[data-people-form="add"], [data-people-form="log-outreach"]') && [...state.dialog.querySelectorAll('input, textarea')].some(input => input.value.trim()));
    const active = () => /^#\/contacts(?:\?|$)/.test(location.hash);
    const alive = () => Boolean(root.querySelector('.people-workspace'));
    const readQuery = () => {
      const params = new URLSearchParams(location.hash.split('?')[1] || '');
      return { q: params.get('q') || '', outreachStatus: params.get('stage') || '', sortBy: params.get('sort') || 'name', page: Math.max(1, Math.min(1000000, Number(params.get('page')) || 1)), pageSize: 20, minScore: params.get('minScore') || '' };
    };
    function hash(query = state.query, person = state.selected) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries({ q: query.q, stage: query.outreachStatus, sort: query.sortBy === 'name' ? '' : query.sortBy, page: query.page > 1 ? query.page : '', minScore: query.minScore, person })) if (value) params.set(key, value);
      return `#/contacts${params.size ? `?${params}` : ''}`;
    }
    function allowLeave() {
      if (state.busy) return false;
      if (!state.dirty) return true;
      if (!window.confirm('Discard unsaved changes to this person? Your saved information will stay unchanged.')) return false;
      state.dirty = false;
      return true;
    }
    function navigate(query, person = '') {
      if (!allowLeave()) return;
      state.scroll = JSON.stringify(query) === JSON.stringify(state.query) ? root.querySelector('.people-table-scroll')?.scrollTop || 0 : 0;
      const next = hash(query, person);
      if (location.hash === next) return;
      location.hash = next;
    }
    function message(text, error = false, target = root.querySelector('[data-person-feedback]')) {
      if (!target) return;
      target.textContent = text;
      target.classList.toggle('is-error', error);
      target.setAttribute('role', error ? 'alert' : 'status');
    }
    function loading() {
      root.innerHTML = `<section class="people-workspace" aria-label="People workspace" aria-busy="true"><div class="people-toolbar"><span role="status">Loading people…</span></div><div class="people-skeleton" aria-hidden="true">${Array.from({ length: 7 }, () => '<div><i></i><span></span><span></span></div>').join('')}</div></section>`;
    }
    function errorState(error) {
      const copy = error?.message || 'The server did not respond.';
      root.innerHTML = `<section class="people-workspace"><div class="people-empty" role="alert"><h3>People couldn’t be loaded</h3><p>${escape(copy)}</p><p>Your saved people are unchanged. Try this search again or return to the full list.</p>${button('retry', 'Try again')}${button('reset-list', 'Show all people')}<a class="ghost-button" href="#/admin">Check workspace settings</a></div></section>`;
    }
    async function render({ force = false } = {}) {
      if (force && !allowLeave()) return;
      const startedAt = performance.now();
      const nextQuery = readQuery();
      const nextPerson = new URLSearchParams(location.hash.split('?')[1] || '').get('person') || '';
      const nextKey = JSON.stringify(nextQuery);
      if ((state.dirty || state.busy) && (nextPerson !== state.selected || nextKey !== state.key) && !allowLeave()) {
        history.replaceState(null, '', lastHash);
        return;
      }
      lastHash = location.hash;
      setTitle('People');
      const ticket = ++state.sequence;
      state.query = nextQuery;
      onQuery(nextQuery);
      const sameList = nextKey === state.key && state.result;
      const samePerson = nextPerson === state.selected;
      state.selected = nextPerson;
      if (sameList && alive() && !force) {
        await renderPerson(ticket, { focus: !samePerson });
        updateSelection();
        return;
      }
      // Retire the displayed query before fetching: old rows and editable
      // details must not remain actionable under a different URL/query.
      state.key = '';
      loading();
      try {
        const result = await api(`/api/contacts?${new URLSearchParams(nextQuery)}`, { skipCache: force });
        if (ticket !== state.sequence || !active()) return;
        if (!result.items.length && nextQuery.page > 1) {
          navigate({ ...nextQuery, page: Math.max(1, Math.ceil(result.total / nextQuery.pageSize)) });
          return;
        }
        state.result = result;
        state.key = nextKey;
        state.checked.clear();
        state.dirty = false;
        draw();
        await renderPerson(ticket, { focus: !samePerson && Boolean(nextPerson) });
        const elapsed = Math.round(performance.now() - startedAt);
        window.dispatchEvent(new CustomEvent('bd:people-timing', { detail: { path: 'app/people-workspace.js::render', elapsedMs: elapsed, rows: result.items.length } }));
      } catch (error) {
        if (ticket === state.sequence && active()) errorState(error);
      }
    }
    function draw() {
      const { result, query } = state;
      const filtered = Boolean(query.q || query.outreachStatus || query.minScore);
      root.innerHTML = `<section class="people-workspace${state.selected ? ' has-person' : ''}" aria-label="People workspace">
        <div class="people-toolbar">
          <div class="people-count"><strong>${result.total.toLocaleString()}</strong> ${filtered ? 'matching' : 'saved'} people<span>Review your network, one person at a time.</span></div>
          <div class="people-toolbar-actions"><button type="button" class="primary-button" data-people="add">Add person</button><button type="button" class="secondary-button" data-action="open-network-import-modal">Import CSV</button>${button('drafts', 'My drafts')}${exportOptions()}</div>
        </div>
        <div class="people-layout">
          <div class="people-master">
            <form id="contacts-filter-form" class="people-filters" data-people-form="filters">
              <div class="people-search"><label class="visually-hidden" for="people-search">Search people</label><input id="people-search" type="search" name="q" value="${escape(query.q)}" placeholder="Name, role, company or notes" autocomplete="off"><button class="ghost-button" type="submit" aria-label="Search people">Search</button></div>
              <label><span class="visually-hidden">Outreach stage</span><select name="outreachStatus" aria-label="Outreach stage">${options({ '': 'All outreach stages', ...stages }, query.outreachStatus)}</select></label>
              <label><span class="visually-hidden">Sort people</span><select name="sortBy" aria-label="Sort people">${options({ name: 'Name A–Z', name_desc: 'Name Z–A', company: 'Company A–Z', recent: 'Recently updated', priority: 'Relationship priority' }, query.sortBy)}</select></label>
              ${filtered ? button('clear', 'Clear filters') : ''}
            </form>
            <div class="people-list-caption"><span>${filtered ? `Filtered results${query.minScore ? ' · Minimum relationship priority ' + escape(query.minScore) : ''}` : 'All people'}${query.sortBy === 'priority' ? ' · Employer/title signals, not candidate fit' : ''}</span><span>${button('save-view', 'Save view')}${button('views', 'My views')}</span></div>
            <div class="people-feedback" data-people-feedback role="status"></div>
            <div class="people-selection" data-people-selection hidden></div>
            ${result.items.length ? table() : `<div class="people-empty"><h3>${filtered ? 'No people match these filters' : 'Your people workspace starts here'}</h3><p>${filtered ? 'Try another name, role or company, or clear the filters to see your saved people.' : 'Add someone you want to review, or import your LinkedIn connections. CSV imports include connection details—not complete candidate profiles.'}</p>${filtered ? button('clear', 'Clear filters') : `${button('add', 'Add your first person')}<button class="secondary-button" type="button" data-action="open-network-import-modal">Import LinkedIn CSV</button>`}</div>`}
            <footer class="people-pagination"><span>${result.total ? `${(result.page - 1) * result.pageSize + 1}–${Math.min(result.page * result.pageSize, result.total)} of ${result.total.toLocaleString()}` : '0 results'}</span><div>${button('previous-page', 'Previous', result.page <= 1 ? 'disabled' : '')}<span>Page ${result.page} of ${Math.max(1, Math.ceil(result.total / result.pageSize))}</span>${button('next-page', 'Next', result.page * result.pageSize >= result.total ? 'disabled' : '')}</div></footer>
          </div>
          <aside class="person-panel" aria-label="Person review" ${state.selected ? '' : 'hidden'}></aside>
        </div>
      </section>`;
      const scroll = root.querySelector('.people-table-scroll');
      if (scroll) scroll.scrollTop = state.scroll;
    }
    function table() {
      return `<div class="people-table-scroll" tabindex="0" role="region" aria-label="People results"><table class="table contacts-table people-table"><colgroup><col class="people-select-col"><col class="people-name-col"><col><col class="people-stage-col"></colgroup><thead><tr><th scope="col"><input type="checkbox" data-people="select-page" aria-label="Select people on this page"></th><th scope="col" aria-sort="${state.query.sortBy === 'name' ? 'ascending' : state.query.sortBy === 'name_desc' ? 'descending' : 'none'}">${button('sort-name', 'Person <span aria-hidden="true">↕</span>')}</th><th scope="col" aria-sort="${state.query.sortBy === 'company' ? 'ascending' : 'none'}">${button('sort-company', 'Company <span aria-hidden="true">↕</span>')}</th><th scope="col">Outreach</th></tr></thead><tbody>${state.result.items.map(row).join('')}</tbody></table></div>`;
    }
    function row(person) {
      return `<tr data-person-row="${escape(person.id)}"${person.id === state.selected ? ' class="is-selected"' : ''}>
        <td><input type="checkbox" class="contacts-bulk-checkbox" data-people="select-person" value="${escape(person.id)}" data-name="${escape(person.fullName)}" data-company="${escape(person.companyName)}" data-title="${escape(person.title)}" data-account-id="${escape(person.accountId)}" data-email="${escape(person.email)}" data-linkedin="${escape(person.linkedinUrl)}" aria-label="Select ${escape(person.fullName)}" ${state.checked.has(person.id) ? 'checked' : ''}></td>
        <td><a class="person-name" href="${escape(hash(state.query, person.id))}" data-people="open" data-id="${escape(person.id)}" ${person.id === state.selected ? 'aria-current="true"' : ''}>${escape(person.fullName || 'Unnamed person')}</a><div class="people-role">${escape(person.title || 'Role not provided')}</div></td>
        <td><span>${escape(person.companyName || 'Not provided')}</span></td><td><span class="people-stage" data-stage="${escape(person.outreachStatus || 'not_started')}">${escape(label(person.outreachStatus))}</span></td>
      </tr>`;
    }
    function updateRow(person) {
      const index = state.result?.items.findIndex(item => item.id === person.id) ?? -1;
      if (index >= 0) state.result.items[index] = person;
      const element = [...root.querySelectorAll('[data-person-row]')].find(item => item.dataset.personRow === person.id);
      if (element) element.outerHTML = row(person);
      onUpdated(person);
    }
    function updateSelection() {
      const count = state.checked.size;
      const bar = root.querySelector('[data-people-selection]');
      if (bar) {
        bar.hidden = !count;
        bar.innerHTML = `<strong>${count} selected on this page</strong>${button('compare', 'Compare', count < 2 || count > 3 ? 'disabled title="Select two or three people"' : '')}<button type="button" class="ghost-button" data-action="launch-batch-outreach-contacts">Prepare batch</button><button type="button" class="ghost-button" data-action="export-selected-contacts-csv">Export selected</button>${button('clear-selection', 'Clear selection')}${count > 3 ? '<span>Select up to 3 to compare.</span>' : ''}`;
      }
      const selectAll = root.querySelector('[data-people="select-page"]');
      if (selectAll) { selectAll.checked = count > 0 && count === state.result.items.length; selectAll.indeterminate = count > 0 && count < state.result.items.length; }
      for (const row of root.querySelectorAll('[data-person-row]')) {
        row.classList.toggle('is-selected', row.dataset.personRow === state.selected);
        const link = row.querySelector('.person-name');
        if (row.dataset.personRow === state.selected) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current');
      }
    }
    async function renderPerson(ticket, { focus = false } = {}) {
      const panel = root.querySelector('.person-panel');
      if (!panel) return;
      root.querySelector('.people-workspace').classList.toggle('has-person', Boolean(state.selected));
      panel.hidden = !state.selected;
      if (!state.selected) {
        panel.innerHTML = '';
        state.person = null;
        if (returnFocus) [...root.querySelectorAll('.person-name')].find(el => el.dataset.id === returnFocus)?.focus({ preventScroll: true });
        return;
      }
      if (state.person?.id === state.selected && state.dirty) return;
      panel.innerHTML = `<div class="person-panel-nav">${button('close', '← Back to people')}</div><p class="people-panel-loading" role="status">Loading person…</p>`;
      let person = state.result.items.find(item => item.id === state.selected);
      try {
        if (!person) person = (await api(`/api/contacts?${new URLSearchParams({ id: state.selected, pageSize: 1 })}`)).items[0];
        if (ticket !== state.sequence || !active()) return;
        if (!person) throw new Error('This person is no longer available in this workspace.');
        state.person = person;
        state.dirty = false;
        drawPerson();
        loadPersonWork(person.id, ticket);
        if (focus) root.querySelector('#person-heading')?.focus({ preventScroll: true });
      } catch (error) {
        if (ticket !== state.sequence || !active()) return;
        panel.innerHTML = `<div class="person-panel-nav">${button('close', '← Back to people')}</div><div class="people-empty" role="alert"><h3>Person unavailable</h3><p>${escape(error.message)}</p>${button('retry', 'Try again')}</div>`;
      }
    }
    function drawPerson() {
      savedDraft = null; savedDraftText = '';
      const person = state.person;
      const panel = root.querySelector('.person-panel');
      const index = state.result.items.findIndex(item => item.id === person.id);
      const source = person.source === 'manual' ? 'Added manually' : /sample|demo/i.test(person.source || person.id) ? 'Sample data' : person.source ? String(person.source).replace(/[_-]/g, ' ') : 'Source not recorded';
      panel.innerHTML = `<div class="person-panel-nav">${button('close', '← Back to people')}<div>${button('previous-person', '↑', `aria-label="Previous person" ${index <= 0 ? 'disabled' : ''}`)}${button('next-person', '↓', `aria-label="Next person" ${index < 0 || index >= state.result.items.length - 1 ? 'disabled' : ''}`)}</div></div>
        <header class="person-identity"><span class="people-source">${escape(source)}</span><h3 id="person-heading" tabindex="-1">${escape(person.fullName)}</h3><p class="person-current-role">${escape(person.title || 'Role not provided')}</p><p>${person.accountId ? `<a href="#/accounts/${escape(person.accountId)}">${escape(person.companyName || 'View company')}</a>` : escape(person.companyName || 'Company not provided')}</p><div class="person-links"><span data-person-profile>${profileLink(person)}</span>${button('prepare', 'Prepare outreach')}</div></header>
        <div class="person-panel-body">
          <dl class="person-facts"><div><dt>Location</dt><dd>${escape(person.location || 'Not provided')}</dd></div><div><dt>Connected</dt><dd>${escape(date(person.connectedOn))}</dd></div><div><dt>Email</dt><dd data-person-email>${escape(person.email || 'Not provided')}</dd></div></dl>
          <p class="people-provenance">Connection details may be out of date. Confirm them on the source profile. No candidate fit assessment has been made.</p>
          ${Array.isArray(person.employmentHistory) && person.employmentHistory.length ? `<details class="person-section"><summary>Supplied experience</summary><ul>${person.employmentHistory.map(item => `<li>${escape(typeof item === 'string' ? item : [item.title || item.position, item.company || item.companyName, item.startDate, item.endDate].filter(Boolean).join(' · '))}</li>`).join('')}</ul></details>` : '<p class="people-provenance">Experience and skills are not included in a connections CSV.</p>'}
          <form class="person-section person-edit-form" data-people-form="person">
            <h4>Recruiter notes</h4>
            ${field('notes', 'Notes', `<textarea id="person-notes" name="notes" rows="5" maxlength="20000" placeholder="Evidence, questions to clarify, and the next step…">${escape(person.notes || '')}</textarea>`)}
            ${field('outreachStatus', 'Outreach stage', `<select id="person-outreachStatus" name="outreachStatus">${options(stages, person.outreachStatus || 'not_started')}</select>`)}
            <details class="person-edit-fields"><summary>Correct contact details</summary>
              ${field('fullName', 'Full name', `<input id="person-fullName" name="fullName" value="${escape(person.fullName)}" required maxlength="200">`)}
              ${field('title', 'Current role', `<input id="person-title" name="title" value="${escape(person.title || '')}" maxlength="300">`)}
              ${field('email', 'Email', `<input id="person-email" name="email" type="email" value="${escape(person.email || '')}" maxlength="320">`)}
              ${field('linkedinUrl', 'Profile URL', `<input id="person-linkedinUrl" name="linkedinUrl" type="url" value="${escape(person.linkedinUrl || '')}" maxlength="2000" placeholder="https://www.linkedin.com/in/…">`)}
            </details>
            <div class="person-save-row"><button class="primary-button" type="submit">Save changes</button><span class="people-feedback" data-person-feedback role="status">${escape(state.notice)}</span></div>
          </form>
          <section class="person-section person-outreach" hidden aria-labelledby="person-outreach-heading"><h4 id="person-outreach-heading">Prepare outreach</h4><p class="people-provenance">Review every claim. Save privately to your account to resume on another device. Saving and copying do not send anything.</p><label class="people-field" for="person-draft"><span>Message</span><textarea id="person-draft" rows="8" maxlength="12000"></textarea></label><div class="person-links">${button('save-draft', 'Save draft')}${button('copy-draft', 'Copy message')}${button('mark-contacted', 'Mark as contacted')}</div><p class="people-feedback" data-draft-feedback role="status"></p></section>
          <details class="person-section"><summary>Follow-ups and activity</summary><form data-people-form="follow-up"><label class="people-field">Next step<input name="summary" required maxlength="240" placeholder="Follow up on our conversation"></label><label class="people-field">Due date<input name="dueDate" type="date" required></label><button class="secondary-button" type="submit">Add follow-up</button><p role="status" data-task-feedback></p></form><div data-person-work role="status">Loading linked work…</div></details>
          <footer class="person-review-footer">${index >= 0 ? `${index + 1} of ${state.result.items.length} on this page · J / K to move when not typing` : 'Opened directly · Not in the current results'}</footer>
        </div>`;
      savedFormValues = Object.fromEntries(new FormData(panel.querySelector('.person-edit-form')));
    }
    async function loadPersonWork(contactId, ticket = state.sequence) {
      try {
        const [tasks, history] = await Promise.all([api(`/api/tasks?${new URLSearchParams({ contactId, pageSize: 10 })}`, { skipCache: true }), api(`/api/activity?${new URLSearchParams({ contactId, pageSize: 10 })}`, { skipCache: true })]);
        if (ticket !== state.sequence || state.selected !== contactId || !active()) return;
        root.querySelector('[data-person-work]').innerHTML = `<h4>Pending follow-ups</h4>${tasks.items.length ? tasks.items.map(task => `<p>${escape(task.summary)} · ${escape(date(task.dueDate))}</p>`).join('') : '<p>No pending follow-ups.</p>'}<a href="#/tasks?contactId=${encodeURIComponent(contactId)}">Open this person’s follow-ups</a><h4>Recent activity</h4>${history.items.length ? history.items.map(item => `<p>${escape(item.summary)} <span class="muted small">${escape(date(item.occurredAt))}</span></p>`).join('') : '<p>No activity recorded for this person yet.</p>'}`;
      } catch (error) { if (ticket === state.sequence && active()) message(`Could not load linked work. ${error.message}`, true, root.querySelector('[data-person-work]')); }
    }
    async function savePerson(form) {
      if (state.busy) return;
      const values = Object.fromEntries([...new FormData(form)].filter(([key, value]) => value !== savedFormValues[key]));
      if (!Object.keys(values).length) { message('No changes to save.'); return; }
      const button = form.querySelector('[type="submit"]');
      const fields = [...form.querySelectorAll('input, textarea, select')];
      const startedAt = performance.now();
      state.busy = true; button.disabled = true; button.textContent = 'Saving…';
      fields.forEach(control => control.disabled = true);
      message('Saving changes…');
      try {
        const updated = await api(`/api/contacts/${encodeURIComponent(state.person.id)}`, { method: 'PATCH', body: JSON.stringify(values) });
        state.person = updated;
        updateRow(updated);
        for (const field of fields) field.value = updated[field.name] ?? (field.name === 'outreachStatus' ? 'not_started' : '');
        savedFormValues = Object.fromEntries(fields.map(field => [field.name, field.value]));
        updateDirty();
        // Keep the form and focus intact; update identity separately.
        root.querySelector('#person-heading').textContent = updated.fullName;
        root.querySelector('.person-current-role').textContent = updated.title || 'Role not provided';
        root.querySelector('[data-person-email]').textContent = updated.email || 'Not provided';
        root.querySelector('[data-person-profile]').innerHTML = profileLink(updated);
        message('Saved.');
        window.dispatchEvent(new CustomEvent('bd:people-timing', { detail: { path: 'app/people-workspace.js::savePerson', elapsedMs: Math.round(performance.now() - startedAt) } }));
      } catch (error) { message(`Could not save. ${error.message} Your changes are still here.`, true); }
      finally { state.busy = false; fields.forEach(control => control.disabled = false); button.disabled = false; button.textContent = 'Save changes'; }
    }
    function openDialog(title, content, className = '') {
      if (!closeDialog()) return;
      const dialog = document.createElement('dialog');
      dialog.className = `people-dialog ${className}`;
      dialog.setAttribute('aria-labelledby', 'people-dialog-title');
      dialog.innerHTML = `<header><h3 id="people-dialog-title">${escape(title)}</h3>${button('close-dialog', '×', 'aria-label="Close dialog"')}</header>${content}`;
      document.body.append(dialog);
      state.dialog = dialog;
      dialog.addEventListener('click', onClick);
      dialog.addEventListener('submit', onSubmit);
      dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
      dialog.addEventListener('close', () => { dialog.remove(); if (state.dialog === dialog) state.dialog = null; });
      dialog.showModal();
    }
    function closeDialog({ saved = false } = {}) {
      if (!state.dialog) return true;
      if (!saved && state.busy) return false;
      if (!saved && hasAddDraft() && !window.confirm('Discard this new person? These details have not been saved.')) return false;
      state.dialog.close(); state.dialog = null;
      return true;
    }
    function addPerson() {
      const discardPerson = state.dirty;
      if (!allowLeave()) return;
      // A confirmed discard must also remove the abandoned values from view.
      if (discardPerson && state.person) drawPerson();
      openDialog('Add person', `<form data-people-form="add"><p class="people-provenance">Save details you have permission to use. Adding a URL does not scrape a profile.</p>${field('new-name', 'Full name', '<input id="person-new-name" name="fullName" required maxlength="200" autofocus>')}${field('new-title', 'Current role', '<input id="person-new-title" name="title" maxlength="300">')}${field('new-company', 'Company', '<input id="person-new-company" name="companyName" maxlength="300">')}${field('new-url', 'Profile URL', '<input id="person-new-url" name="linkedinUrl" type="url" maxlength="2000" placeholder="https://www.linkedin.com/in/…">')}<p class="people-feedback" data-add-feedback role="status"></p><footer><button class="primary-button" type="submit">Add person</button>${button('close-dialog', 'Cancel')}</footer></form>`);
    }
    function compare() {
      const people = state.result.items.filter(item => state.checked.has(item.id));
      if (people.length < 2 || people.length > 3) return;
      const rows = [['Current role', p => p.title], ['Company', p => p.companyName], ['Location', p => p.location], ['Outreach stage', p => label(p.outreachStatus)], ['Recruiter notes', p => p.notes], ['Source', p => p.source], ['Connected', p => date(p.connectedOn)]];
      openDialog('Compare people', `<p class="people-provenance">Known information only. This comparison does not rank suitability or infer missing experience.</p><div class="people-compare-scroll" tabindex="0" role="region" aria-label="Comparison table"><table class="people-compare"><thead><tr><th scope="col">Information</th>${people.map(p => `<th scope="col">${escape(p.fullName)}</th>`).join('')}</tr></thead><tbody>${rows.map(([title, get]) => `<tr><th scope="row">${title}</th>${people.map(p => `<td>${escape(get(p) || 'Not provided')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`, 'people-dialog--wide');
    }
    async function onSubmit(event) {
      const form = event.target.closest('[data-people-form]');
      if (!form) return;
      event.preventDefault(); event.stopPropagation();
      if (form.dataset.peopleForm === 'filters') return navigate({ ...state.query, ...Object.fromEntries(new FormData(form)), page: 1 });
      if (form.dataset.peopleForm === 'person') return savePerson(form);
      if (form.dataset.peopleForm === 'log-outreach') {
        if (state.busy) return;
        const values = Object.fromEntries(new FormData(form));
        if (/\[(?:add|Add)/.test(values.text)) return message('Replace the placeholders with the message you actually sent.', true, form.querySelector('[data-log-feedback]'));
        state.busy = true;
        const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
        try {
          const result = await api(`/api/contacts/${encodeURIComponent(state.person.id)}/outreach`, { method: 'POST', body: JSON.stringify({ text: values.text, followUpDays: Number(values.followUpDays), confirmed: values.confirmed === 'on', requestId: state.outreachRequest }) });
          state.person = result.person; updateRow(result.person);
          savedFormValues.outreachStatus = result.person.outreachStatus;
          root.querySelector('#person-outreachStatus').value = result.person.outreachStatus;
          state.outreachRequest = null;
          closeDialog({ saved: true }); updateDirty();
          message(`Outreach recorded in activity history. No message was sent by this app.${result.activity?.warning ? ' ' + result.activity.warning.message : ''}`, Boolean(result.activity?.warning), root.querySelector('[data-draft-feedback]'));
          await loadPersonWork(result.person.id);
        } catch (error) { message(error.message, true, form.querySelector('[data-log-feedback]')); }
        finally { state.busy = false; submit.disabled = false; }
        return;
      }
      if (form.dataset.peopleForm === 'follow-up') {
        if (state.busy) return;
        const contactId = state.person.id;
        const submit = form.querySelector('button'); submit.disabled = true; state.busy = true;
        try {
          await api('/api/tasks', { method: 'POST', body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), contactId }) });
          form.reset(); message('Follow-up saved for this person.', false, form.querySelector('[data-task-feedback]'));
          await loadPersonWork(contactId);
        } catch (error) { message(error.message, true, form.querySelector('[data-task-feedback]')); }
        finally { state.busy = false; submit.disabled = false; }
        return;
      }
      if (form.dataset.peopleForm !== 'add') return;
      const submit = form.querySelector('[type="submit"]');
      if (submit.disabled || state.busy) return;
      const values = Object.fromEntries(new FormData(form));
      const dialog = form.closest('dialog');
      const controls = [...dialog.querySelectorAll('input, button')];
      const startedAt = performance.now();
      state.busy = true;
      controls.forEach(control => control.disabled = true);
      dialog.setAttribute('aria-busy', 'true');
      submit.disabled = true; submit.textContent = 'Adding…';
      message('Saving person… Please wait before closing.', false, form.querySelector('[data-add-feedback]'));
      try {
        const created = await api('/api/contacts', { method: 'POST', body: JSON.stringify(values) });
        closeDialog({ saved: true });
        state.busy = false;
        state.key = '';
        navigate({ q: '', outreachStatus: '', sortBy: 'recent', page: 1, pageSize: 20, minScore: '' }, created.id);
      } catch (error) { message(`Could not add person. ${error.message}`, true, form.querySelector('[data-add-feedback]')); }
      finally {
        state.busy = false;
        controls.forEach(control => control.disabled = false);
        dialog.setAttribute('aria-busy', 'false');
        submit.textContent = 'Add person';
        window.dispatchEvent(new CustomEvent('bd:people-timing', { detail: { path: 'app/people-workspace.js::addPerson', elapsedMs: Math.round(performance.now() - startedAt) } }));
      }
    }
    async function onClick(event) {
      const control = event.target.closest('[data-people]');
      if (!control || control.disabled) return;
      const action = control.dataset.people;
      // Checkbox defaults must run; change handler owns their state.
      if (action.startsWith('select-')) return;
      event.preventDefault(); event.stopPropagation();
      if (action === 'open') { returnFocus = control.dataset.id; navigate(state.query, control.dataset.id); }
      if (action === 'close') navigate(state.query);
      if (action === 'retry') await render({ force: true });
      if (action === 'reset-list') {
        const query = { q: '', outreachStatus: '', sortBy: 'name', page: 1, pageSize: 20, minScore: '' };
        if (location.hash === hash(query, '')) await render({ force: true });
        else navigate(query);
      }
      if (action === 'clear') navigate({ ...state.query, q: '', outreachStatus: '', minScore: '', page: 1 });
      if (action === 'previous-page' || action === 'next-page') { state.scroll = 0; navigate({ ...state.query, page: state.query.page + (action === 'next-page' ? 1 : -1) }); }
      if (action === 'sort-name') navigate({ ...state.query, sortBy: state.query.sortBy === 'name' ? 'name_desc' : 'name', page: 1 });
      if (action === 'sort-company') navigate({ ...state.query, sortBy: 'company', page: 1 });
      if (action === 'next-person' || action === 'previous-person') move(action === 'next-person' ? 1 : -1);
      if (action === 'add') addPerson();
      if (action === 'drafts') window.bdSavedWork.openLibrary('draft');
      if (action === 'save-view') window.bdSavedWork.saveView(state.query);
      if (action === 'views') window.bdSavedWork.openLibrary('view', query => navigate({ ...query, page: 1, pageSize: 20 }));
      if (action === 'compare') compare();
      if (action === 'close-dialog') closeDialog();
      if (action === 'clear-selection') { state.checked.clear(); root.querySelectorAll('[data-people="select-person"]').forEach(el => el.checked = false); updateSelection(); }
      if (action === 'prepare') {
        if (state.busy) return;
        const section = root.querySelector('.person-outreach'); section.hidden = false;
        const textarea = section.querySelector('textarea');
        if (!textarea.value) {
          control.disabled = true; state.busy = true;
          try {
            savedDraft = await window.bdSavedWork.load('draft', `person-${state.person.id}`);
            savedDraftText = savedDraft?.body.text || '';
            if (savedDraft) textarea.value = savedDraftText;
          } catch (error) { message(`Could not load the saved draft. ${error.message} Retry before editing.`, true, root.querySelector('[data-draft-feedback]')); return; }
          finally { control.disabled = false; state.busy = false; }
        }
        if (!textarea.value) textarea.value = `Hi ${state.person.fullName?.trim().split(/\s+/)[0] || state.person.firstName || 'there'},\n\nI'm reaching out about [add the role or reason for contacting this person].\n\n[Add relevant, verified details and a clear next step.]\n\nWould you be open to a brief conversation?`;
        textarea.focus();
      }
      if (action === 'save-draft') {
        if (state.busy) return;
        const textarea = root.querySelector('#person-draft');
        const text = textarea.value;
        control.disabled = true; state.busy = true;
        try {
          savedDraft = await window.bdSavedWork.save('draft', `person-${state.person.id}`, { title: `Outreach to ${state.person.fullName}`.slice(0, 160), body: { text, contactId: state.person.id, accountId: state.person.accountId || '', recipient: state.person.fullName }, version: savedDraft?.version || 0 });
          savedDraftText = text; updateDirty(); message(state.dirty ? 'Unsaved contact changes' : 'Saved.'); message('Saved to your account. Nothing was sent.', false, root.querySelector('[data-draft-feedback]'));
        } catch (error) {
          message(error.message, true, root.querySelector('[data-draft-feedback]'));
          if (error.status === 409) window.bdSavedWork.resolveConflict(`person-${state.person.id}`, { title: `Outreach to ${state.person.fullName}`.slice(0, 160), body: { text: textarea.value, contactId: state.person.id, accountId: state.person.accountId || '', recipient: state.person.fullName } }, latest => { savedDraft = latest; textarea.value = savedDraftText = latest.body.text; updateDirty(); message('Latest saved copy loaded.', false, root.querySelector('[data-draft-feedback]')); });
        }
        finally { control.disabled = false; state.busy = false; }
      }
      if (action === 'copy-draft') {
        const textarea = root.querySelector('#person-draft');
        const target = root.querySelector('[data-draft-feedback]');
        if (!textarea.value.trim() || /\[(?:add|Add)/.test(textarea.value)) { message('Replace the placeholders with your own verified details before copying.', true, target); return; }
        try { await navigator.clipboard.writeText(textarea.value); message('Copied. Nothing was sent and the stage is unchanged.', false, target); }
        catch { textarea.select(); message('Clipboard access unavailable. The message is selected; use your copy shortcut.', true, target); }
      }
      if (action === 'mark-contacted') {
        if (state.busy) return;
        state.outreachRequest ||= crypto.randomUUID();
        openDialog('Log sent outreach', `<form data-people-form="log-outreach"><p>Record what you sent to ${escape(state.person.fullName)}. This app does not send messages. Later outreach stages are preserved.</p><label class="people-field">Sent message<textarea name="text" rows="7" maxlength="12000" required>${escape(root.querySelector('#person-draft').value)}</textarea></label><label class="people-field">Schedule follow-up<select name="followUpDays"><option value="0">No follow-up</option><option value="3">In 3 days</option><option value="7">In 7 days</option><option value="14">In 14 days</option></select></label><label><input name="confirmed" type="checkbox" required> I already sent this message outside the app</label><p role="status" data-log-feedback></p><button class="primary-button" type="submit">Record outreach</button></form>`);
      }
    }
    function move(direction) {
      const index = state.result.items.findIndex(item => item.id === state.selected);
      const next = state.result.items[index + direction];
      if (index >= 0 && next) { returnFocus = next.id; navigate(state.query, next.id); }
    }
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit, true);
    root.addEventListener('change', event => {
      if (!alive()) return;
      const target = event.target;
      if (target.closest('[data-people-form="filters"]') && target.tagName === 'SELECT') { target.form.requestSubmit(); return; }
      if (target.dataset.people === 'select-person') {
        event.stopPropagation();
        if (target.checked) state.checked.add(target.value); else state.checked.delete(target.value);
        updateSelection();
      }
      if (target.dataset.people === 'select-page') {
        event.stopPropagation(); state.checked.clear();
        root.querySelectorAll('[data-people="select-person"]').forEach(input => { input.checked = target.checked; if (input.checked) state.checked.add(input.value); });
        updateSelection();
      }
    });
    root.addEventListener('input', event => {
      if (event.target.closest('.person-edit-form') || event.target.id === 'person-draft') { updateDirty(); message(state.dirty ? 'Unsaved changes' : 'Saved'); }
    });
    // Guard navigation to legacy routes too, without taking over the router.
    document.addEventListener('click', event => {
      const link = event.target.closest('a[href^="#/"]');
      if (active() && state.dirty && link && !link.dataset.people && !allowLeave()) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    document.addEventListener('keydown', event => {
      if (!active() || !alive() || document.querySelector('dialog[open], .modal-backdrop:not(.hidden)')) return;
      if (event.target.closest('input, textarea, select, [contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.key === 'j' || event.key === 'k') && state.selected) { event.preventDefault(); event.stopImmediatePropagation(); move(event.key === 'j' ? 1 : -1); }
      if (event.key === 'Escape' && state.selected) { event.preventDefault(); event.stopImmediatePropagation(); navigate(state.query); }
    }, true);
    window.addEventListener('beforeunload', event => { if (state.dirty || state.busy || hasAddDraft()) { event.preventDefault(); event.returnValue = ''; } });
    return { render, allowLeave, beforeLeave: () => { if (allowLeave()) return true; history.replaceState(null, '', lastHash); return false; }, leave: () => { ++state.sequence; state.key = ''; }, open: id => navigate(state.query, id) };
  }
  window.bdPeople = { create };
})();
