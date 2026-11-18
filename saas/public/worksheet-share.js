const canonical = document.querySelector('link[rel="canonical"]');
const copyButton = document.getElementById('copy-worksheet-link');
const status = document.getElementById('worksheet-share-status');

if (canonical && copyButton && status && navigator.clipboard?.writeText) {
  const url = new URL(canonical.href);
  url.search = new URLSearchParams({
    utm_source: 'worksheet_share',
    utm_medium: 'referral',
    utm_campaign: 'target_accounts_guide',
  });
  url.hash = 'template';

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url.href);
      status.textContent = 'Worksheet link copied.';
    } catch {
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = 'Open the worksheet share link';
      status.replaceChildren('Couldn’t copy the link. ', link, '.');
    }
  });
  copyButton.hidden = false;
}
