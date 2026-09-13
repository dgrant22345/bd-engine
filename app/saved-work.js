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
  function saveView(query) {
    const element = dialog('Save People view', '<form><p>Private to your login in this workspace. Filters update as your people change; this is not a fixed membership list.</p><label class="people-field">View name<input name="title" required maxlength="160" autofocus placeholder="Hiring managers to contact"></label><p role="status" data-feedback></p><button class="primary-button" type="submit">Save view</button></form>');
    element.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const button = event.target.querySelector('button'); button.disabled = true;
      try { await save('view', crypto.randomUUID(), { title: event.target.elements.title.value, body: query, version: 0 }); element.close(); }
      catch (error) { element.querySelector('[data-feedback]').textContent = error.message; }
      finally { button.disabled = false; }
    };
  }
  function openLibrary(kind = 'draft', onSelect) {
    let page = 1;
    let search = '';
    let request = 0;
    const element = dialog(kind === 'draft' ? 'My saved drafts' : 'My saved People views', `<p class="people-provenance">Private to your login in this workspace. Available on your other signed-in devices.</p><form data-search><label class="people-field">Search saved ${kind === 'draft' ? 'drafts' : 'views'}<input name="q" type="search" maxlength="240"></label><button class="secondary-button">Search</button></form><p role="status" data-feedback></p><div data-items></div><footer><button class="secondary-button" data-prev>Previous</button><span data-page></span><button class="secondary-button" data-next>Next</button></footer>`);
    const feedback = element.querySelector('[data-feedback]');
    const items = element.querySelector('[data-items]');
    async function refresh() {
      const current = ++request;
      feedback.textContent = 'Loading…';
      items.inert = true;
      try {
        const result = await api(`/api/saved-work/${kind}?${new URLSearchParams({ page, q: search })}`);
        if (!element.isConnected || current !== request) return;
        page = result.page;
        if (!result.items.length && page > 1) { page -= 1; return refresh(); }
        feedback.textContent = result.items.length ? '' : 'Nothing saved here yet.';
        items.innerHTML = result.items.map((item, index) => `<article class="person-section"><strong>${escape(item.title)}</strong><p class="small muted">Saved ${escape(new Date(item.updatedAt).toLocaleString())}</p><div class="button-row"><button class="secondary-button" data-open="${index}">${kind === 'draft' ? 'Open draft' : 'Apply view'}</button><button class="ghost-button" data-delete="${index}">Delete</button></div></article>`).join('');
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
      } catch (error) { if (current === request) feedback.textContent = `Could not load saved work. ${error.message} Search again to retry.`; }
      finally { if (current === request) items.inert = false; }
    }
    function openDraft(item) {
      const editor = dialog(item.title, `<form><p class="people-provenance">Saved draft, not a sent message. Review every claim before using it.</p><label class="people-field">Message<textarea name="text" rows="10" maxlength="12000" required>${escape(item.body.text)}</textarea></label><p data-status role="status"></p><div class="button-row"><button class="primary-button" type="submit">Save changes</button><button class="secondary-button" type="button" data-copy>Copy message</button>${item.body.contactId ? `<a class="secondary-button" href="#/contacts?person=${encodeURIComponent(item.body.contactId)}" data-person>Open person</a>` : ''}</div></form>`);
      const textarea = editor.querySelector('textarea');
      let savedText = item.body.text;
      let busy = false;
      const canClose = () => !busy && (textarea.value === savedText || confirm('Discard unsaved draft changes? Your saved copy will stay unchanged.'));
      editor.querySelector('[data-close]').onclick = () => { if (canClose()) editor.close(); };
      editor.addEventListener('cancel', event => { event.preventDefault(); if (canClose()) editor.close(); });
      const unload = event => { if (busy || textarea.value !== savedText) { event.preventDefault(); event.returnValue = ''; } };
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
        try { item = await save('draft', item.id, { ...item, body: { ...item.body, text } }); savedText = text; editor.querySelector('[data-status]').textContent = 'Saved to your account.'; }
        catch (error) { editor.querySelector('[data-status]').textContent = `${error.message} Copy your current text before reopening the latest saved draft.`; }
        finally { busy = false; submit.disabled = false; }
      };
    }
    element.querySelector('[data-search]').onsubmit = event => { event.preventDefault(); search = event.target.elements.q.value; page = 1; refresh(); };
    element.querySelector('[data-prev]').onclick = () => { page -= 1; refresh(); };
    element.querySelector('[data-next]').onclick = () => { page += 1; refresh(); };
    refresh();
  }
  window.bdSavedWork = { keyFor, load, save, saveView, openLibrary };
})();
