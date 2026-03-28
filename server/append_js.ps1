$js = @"

async function generateSmartOutreach(accountId, btn) {
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generating...';
  try {
    const res = await api('/api/intelligence/draft-outreach?companyId=' + encodeURIComponent(accountId));
    if (res.error) throw new Error(res.error);
    
    const existing = document.getElementById('ai-outreach-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'ai-outreach-modal';
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.backgroundColor = 'rgba(0,0,0,0.85)';
    modal.style.backdropFilter = 'blur(12px)';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = '9999';
    modal.innerHTML = \`
      <div class="detail-card" style="width: 600px; max-width: 90vw; max-height: 85vh; overflow-y: auto; display: flex; flex-direction: column; gap: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--line); padding-bottom: 12px;">
          <h3 style="margin: 0; font-size: 1.4rem;">🪄 AI Outreach Generated</h3>
          <button class="ghost-button close-modal" style="border: none; background: transparent; font-size: 1.5rem; cursor: pointer;">&times;</button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <div style="background: var(--surface-muted); padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--line);">
            <strong style="display: block; margin-bottom: 8px; color: var(--muted); font-size: 0.8rem; text-transform: uppercase;">System Prompt (Contact: \${escapeHtml(res.metadata.contact)})</strong>
            <p style="font-family: monospace; font-size: 0.85rem; color: var(--text-muted); margin: 0; white-space: pre-wrap;">\${escapeHtml(res.prompt)}</p>
          </div>
          <div>
            <strong style="display: block; margin-bottom: 8px;">Subject: Accelerated Engineering Growth</strong>
            <textarea readonly style="width: 100%; height: 200px; padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--line); background: var(--surface); color: var(--text); font-family: inherit; font-size: 0.95rem; resize: none;">\${res.draft}</textarea>
          </div>
        </div>
        <div style="display: flex; justify-content: flex-end; padding-top: 12px;">
          <button class="primary-button copy-draft" style="background: var(--accent); color: white; border: none; border-radius: var(--radius-md); padding: 10px 16px; font-weight: 600;">Copy to Clipboard</button>
        </div>
      </div>
    \`;
    
    document.body.appendChild(modal);
    
    modal.querySelector('.close-modal').onclick = () => modal.remove();
    modal.querySelector('.copy-draft').onclick = (e) => {
      navigator.clipboard.writeText(res.draft);
      e.target.textContent = 'Copied!';
      setTimeout(() => e.target.textContent = 'Copy to Clipboard', 2000);
    };
  } catch (err) {
    window.bdLocalApi.handleError(err, document.getElementById('app-alert'));
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}
"@

Add-Content -Path '.\app\app.js' -Value $js
