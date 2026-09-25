/* Private, account-backed drafts and People views. No message sending. */
(() => {
  const api = (path, options = {}) => window.bdLocalApi.api(null, path, { ...options, skipCache: true, signal: AbortSignal.timeout(15000) });
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const path = (kind, id) => `/api/saved-work/${kind}/${encodeURIComponent(id)}`;
  const load = async (kind, id) => { try { return await api(path(kind, id)); } catch (error) { if (error.status === 404) return null; throw error; } };
  const save = (kind, id, item) => api(path(kind, id), { method: 'PUT', body: JSON.stringify(item) });
  async function keyFor(value) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function dialog(title, content) {
    const trigger = document.activeElement;
    const element = document.createElement('dialog');
    element.className = 'people-dialog';
    element.setAttribute('aria-label', title);
    element.innerHTML = `<header><h3>${escape(title)}</h3><button type="button" class="ghost-button" data-close aria-label="Close dialog">×</button></header>${content}`;
    document.body.append(element);
    element.querySelector('[data-close]').onclick = () => element.close();
    element.addEventListener('close', () => { element.remove(); if (trigger?.isConnected) trigger.focus(); });
    element.showModal();
    return element;
  }
  function saveView(query, { viewType = 'people' } = {}) {
    query = viewType === 'jobs' ? { ...query, viewType } : { ...query };
    const element = dialog('Save People view', '<form><p>Private to your login in this workspace. Filters update as your people change; this is not a fixed membership list.</p><label class="people-field">View name<input name="title" required maxlength="160" autofocus placeholder="Hiring managers to contact"></label><p role="status" data-feedback></p><button class="primary-button" type="submit">Save view</button></form>');
    if (viewType === 'jobs') {
      element.setAttribute('aria-label', 'Save role search');
      element.querySelector('h3').textContent = 'Save role search';
      element.querySelector('form p').textContent = 'Private to your login in this workspace. Saves applied filters, not a fixed list of jobs. Results use your current role focus.';
      element.querySelector('input').placeholder = 'Canadian recruiting roles';
      element.querySelector('[type="submit"]').textContent = 'Save search';
    }
    element.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const button = event.target.querySelector('button'); button.disabled = true;
      try { await save('view', crypto.randomUUID(), { title: event.target.elements.title.value, body: query, version: 0 }); element.close(); }
      catch (error) { element.querySelector('[data-feedback]').textContent = error.message; }
      finally { button.disabled = false; }
    };
  }
  function resolveConflict(id, current, onLoad) {
    const element = dialog('Resolve draft conflict', '<p>Your text is still in the editor. Save it separately to keep both versions, or load the latest saved copy.</p><div class="button-row"><button type="button" class="primary-button" data-separate>Save as a separate draft</button><button type="button" class="secondary-button" data-latest>Load latest</button></div><p role="status" data-feedback></p>');
    let busy = false;
    const feedback = element.querySelector('[data-feedback]');
    element.querySelector('[data-close]').onclick = () => { if (!busy) element.close(); };
    element.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    async function run(action) {
      if (busy) return; busy = true;
      for (const button of element.querySelectorAll('button')) button.disabled = true;
      try { await action(); }
      catch (error) { feedback.textContent = error.message; }
      finally { busy = false; for (const button of element.querySelectorAll('button')) button.disabled = false; }
    }
    element.querySelector('[data-separate]').onclick = () => run(async () => {
      await save('draft', crypto.randomUUID(), { ...current, title: `${current.title.slice(0, 150)} (copy)`, version: 0 });
      feedback.textContent = 'Separate draft saved in My saved drafts. Your original editor is unchanged.';
      element.querySelector('[data-separate]').hidden = true;
    });
    element.querySelector('[data-latest]').onclick = () => {
      if (!confirm('Replace the text in this editor with the latest saved copy? Save a separate draft first if you want to keep your edits.')) return;
      run(async () => {
        const latest = await load('draft', id);
        if (!latest) throw new Error('The saved copy was removed. You can save your edits as a separate draft.');
        onLoad(latest); element.close();
      });
    };
  }
  function openLibrary(kind = 'draft', onSelect, { viewType = 'people' } = {}) {
    let page = 1;
    let search = '';
    let request = 0;
    const element = dialog(kind === 'draft' ? 'My saved drafts' : 'My saved People views', `<p class="people-provenance">Private to your login in this workspace. Available on your other signed-in devices.</p><form data-search><label class="people-field">Search saved ${kind === 'draft' ? 'drafts' : 'views'}<input name="q" type="search" maxlength="240"></label><button class="secondary-button">Search</button></form><p role="status" data-feedback></p><div data-items></div><footer><button class="secondary-button" data-prev>Previous</button><span data-page></span><button class="secondary-button" data-next>Next</button></footer>`);
    const feedback = element.querySelector('[data-feedback]');
    const items = element.querySelector('[data-items]');
    if (kind === 'view' && viewType === 'jobs') {
      element.setAttribute('aria-label', 'Saved role searches');
      element.querySelector('h3').textContent = 'Saved role searches';
    }
    const retry = document.createElement('button');
    retry.type = 'button'; retry.className = 'secondary-button'; retry.textContent = 'Try again'; retry.hidden = true;
    feedback.after(retry);
    retry.onclick = () => refresh();
    async function refresh() {
      const current = ++request;
      feedback.setAttribute('role', 'status');
      feedback.textContent = 'Loading…';
      retry.hidden = true;
      items.replaceChildren();
      items.inert = true;
      items.setAttribute('aria-busy', 'true');
      element.querySelector('[data-prev]').disabled = true;
      element.querySelector('[data-next]').disabled = true;
      element.querySelector('[data-page]').textContent = '';
      try {
        const result = await api(`/api/saved-work/${kind}?${new URLSearchParams({ page, q: search, ...(kind === 'view' ? { viewType } : {}) })}`);
        if (!element.isConnected || current !== request) return;
        page = result.page;
        if (!result.items.length && page > 1) { page -= 1; return refresh(); }
        feedback.textContent = result.items.length ? '' : 'Nothing saved here yet.';
        items.innerHTML = result.items.map((item, index) => `<article class="person-section saved-work-item"><strong>${escape(item.title)}</strong>${kind === 'draft' ? `<p class="small muted">${escape([item.body.recipient, item.body.roleTitle, item.body.companyName].filter(Boolean).join(' · ') || 'No recipient or role saved')}</p><p class="saved-draft-preview">${escape(item.body.text.replace(/\s+/g, ' ').slice(0, 180))}${item.body.text.replace(/\s+/g, ' ').length > 180 ? '…' : ''}</p>` : ''}<p class="small muted">Saved ${escape(new Date(item.updatedAt).toLocaleString())}</p><div class="button-row"><button class="secondary-button" data-open="${index}">${kind === 'draft' ? 'Open draft' : 'Apply view'}</button><button class="ghost-button" data-delete="${index}">Delete</button></div></article>`).join('');
        items.inert = false;
        element.querySelector('[data-prev]').disabled = page <= 1;
        element.querySelector('[data-next]').disabled = result.items.length < result.pageSize || page * result.pageSize >= result.total;
        element.querySelector('[data-page]').textContent = `Page ${page}`;
        for (const button of items.querySelectorAll('[data-open]')) button.onclick = () => {
          const item = result.items[Number(button.dataset.open)];
          if (kind === 'view') { element.close(); onSelect?.(item.body); }
          else openDraft(item);
        };
        for (const button of items.querySelectorAll('[data-delete]')) button.onclick = async () => {
          const item = result.items[Number(button.dataset.delete)];
          if (!confirm(`Delete “${item.title}”? This removes the saved copy from your devices.`)) return;
          button.disabled = true;
          try { await api(`${path(kind, item.id)}?version=${item.version}`, { method: 'DELETE' }); await refresh(); }
          catch (error) { feedback.textContent = error.message; button.disabled = false; }
        };
      } catch (error) {
        if (current === request && element.isConnected) {
          feedback.setAttribute('role', 'alert');
          feedback.textContent = `Could not load saved work. ${error.message} Your saved items are unchanged.`;
          retry.hidden = false;
        }
      }
      finally { if (current === request) items.setAttribute('aria-busy', 'false'); }
    }
    function openDraft(item) {
      const editor = dialog(item.title, `<form><p class="people-provenance">Saved draft, not a sent message. Review every claim before using it.</p><label class="people-field">Draft name<input name="title" required maxlength="160" value="${escape(item.title)}"></label><label class="people-field">Message<textarea name="text" rows="10" maxlength="12000" required>${escape(item.body.text)}</textarea></label><p data-status role="status"></p><div class="button-row"><button class="primary-button" type="submit">Save changes</button><button class="secondary-button" type="button" data-copy>Copy message</button>${item.body.contactId ? `<a class="secondary-button" href="#/contacts?person=${encodeURIComponent(item.body.contactId)}" data-person>Open person</a>` : ''}</div></form>`);
      const textarea = editor.querySelector('textarea');
      const titleInput = editor.querySelector('[name="title"]');
      let savedText = item.body.text;
      let savedTitle = item.title;
      let busy = false;
      const dirty = () => textarea.value !== savedText || titleInput.value !== savedTitle;
      const updateHeading = () => { editor.querySelector('header h3').textContent = item.title; editor.setAttribute('aria-label', item.title); };
      const canClose = () => !busy && (!dirty() || confirm('Discard unsaved draft changes? Your saved copy will stay unchanged.'));
      editor.querySelector('[data-close]').onclick = () => { if (canClose()) editor.close(); };
      editor.addEventListener('cancel', event => { event.preventDefault(); if (canClose()) editor.close(); });
      const unload = event => { if (busy || dirty()) { event.preventDefault(); event.returnValue = ''; } };
      window.addEventListener('beforeunload', unload);
      editor.addEventListener('close', () => { window.removeEventListener('beforeunload', unload); if (element.isConnected) refresh(); });
      editor.querySelector('[data-person]')?.addEventListener('click', event => { if (!canClose()) event.preventDefault(); else { editor.close(); element.close(); } });
      editor.querySelector('[data-copy]').onclick = async () => {
        try { await navigator.clipboard.writeText(textarea.value); editor.querySelector('[data-status]').textContent = 'Copied. Nothing was sent.'; }
        catch { editor.querySelector('[data-status]').textContent = 'Copy unavailable. Select the text and copy it manually.'; }
      };
      editor.querySelector('form').onsubmit = async event => {
        event.preventDefault(); if (busy) return; busy = true;
        const submit = editor.querySelector('[type="submit"]'); submit.disabled = true;
        const text = textarea.value;
        const title = titleInput.value;
        try { item = await save('draft', item.id, { ...item, title, body: { ...item.body, text } }); savedText = text; savedTitle = title; updateHeading(); editor.querySelector('[data-status]').textContent = dirty() ? 'Saved. You have newer unsaved edits.' : 'Saved to your account.'; }
        catch (error) {
          editor.querySelector('[data-status]').textContent = error.message;
          if (error.status === 409) resolveConflict(item.id, { ...item, title: titleInput.value, body: { ...item.body, text: textarea.value } }, latest => { item = latest; textarea.value = savedText = latest.body.text; titleInput.value = savedTitle = latest.title; updateHeading(); editor.querySelector('[data-status]').textContent = 'Latest saved copy loaded.'; });
        }
        finally { busy = false; submit.disabled = false; }
      };
    }
    element.querySelector('[data-search]').onsubmit = event => { event.preventDefault(); search = event.target.elements.q.value; page = 1; refresh(); };
    element.querySelector('[data-prev]').onclick = () => { page -= 1; refresh(); };
    element.querySelector('[data-next]').onclick = () => { page += 1; refresh(); };
    refresh();
  }
  window.bdSavedWork = { keyFor, load, save, saveView, openLibrary, resolveConflict, dialog };
})();
