// Server-side rendering of the public landing page.
//
// public/index.html builds the landing page in the browser. Without help, a
// signed-out visitor sees a loading spinner until an account check returns,
// and any client that does not run JavaScript (several search and AI crawlers)
// receives an empty document. To avoid both, the server evaluates the page's
// own landing template once per persona and places the result inside
// #cloud-root for signed-out requests. The template stays in index.html as the
// single source of truth; nothing here duplicates its copy.
import vm from 'node:vm';

const TEMPLATE_START = '// <landing-template>';
const TEMPLATE_END = '// </landing-template>';
const ROOT_PLACEHOLDER = '<div id="cloud-root"></div>';

// Query parameters that never change which view the page opens on. Any other
// parameter (login, signup, legal, reset, verify, ...) means the page may open
// on a different view, so the request is served without a pre-rendered body.
const PASSIVE_QUERY_PARAM = /^(utm_[a-z0-9_]+|ref|persona|gclid|gbraid|wbraid|fbclid|msclkid|li_fat_id|ttclid|twclid)$/i;

function escapeHtml(value) {
  return String(value || '').replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]);
}

export function extractLandingTemplate(indexHtml) {
  const html = String(indexHtml || '');
  const start = html.indexOf(TEMPLATE_START);
  const end = html.indexOf(TEMPLATE_END);
  if (start < 0 || end < start) throw new Error('Landing template markers were not found in index.html.');
  return html.slice(start + TEMPLATE_START.length, end);
}

// Runs the template with the state a first-time, signed-out visitor has.
export function renderLandingHtml(indexHtml, persona = 'bd') {
  const sandbox = {
    state: { signupPersona: persona === 'jobseeker' ? 'jobseeker' : 'bd', accountClosedMessage: '', busy: false },
    root: { innerHTML: '' },
    escapeHtml,
    Date,
  };
  vm.runInNewContext(extractLandingTemplate(indexHtml), sandbox, { timeout: 2000 });
  const rendered = String(sandbox.root.innerHTML || '').trim();
  if (!rendered.includes('<h1')) throw new Error('Landing template rendered without a headline.');
  return rendered;
}

export function landingPersonaForRequest(pathname, searchParams) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  return path === '/job-search' || searchParams?.get?.('persona') === 'jobseeker' ? 'jobseeker' : 'bd';
}

export function canPrerenderLanding({ method, searchParams, hasSession }) {
  if (hasSession) return false;
  if (method !== 'GET' && method !== 'HEAD') return false;
  for (const name of searchParams?.keys?.() || []) {
    if (!PASSIVE_QUERY_PARAM.test(name)) return false;
  }
  return true;
}

export function insertPrerenderedLanding(shellHtml, landingHtml) {
  const shell = String(shellHtml || '');
  if (!shell.includes(ROOT_PLACEHOLDER)) throw new Error('The cloud shell root element was not found.');
  // A function replacement keeps "$" sequences in the markup literal.
  return shell.replace(ROOT_PLACEHOLDER, () => `<div id="cloud-root" data-prerendered="landing">${landingHtml}</div>`);
}
