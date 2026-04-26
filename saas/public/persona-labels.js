/**
 * BD Engine Cloud – Persona Label Overlay
 * 
 * Injected by the cloud shell after the main app loads.
 * Swaps UI labels based on the user's persona (bd vs jobseeker).
 * Runs non-destructively — the base app.js is never modified.
 */
(function () {
  'use strict';

  const LABELS = {
    bd: {
      eyebrow: 'Commercial BD platform',
      topbarEyebrow: 'Commercial revenue operating system',
      brandCopy: 'Commercial BD intelligence, live hiring coverage, and ATS import orchestration in one place.',
      navDashboard: 'Dashboard',
      navAccounts: 'Accounts',
      navContacts: 'Contacts',
      navJobs: 'Jobs',
      navAdmin: 'Admin',
      searchPlaceholder: 'Type a company, person, or role',
      searchLabel: 'Search companies, contacts, jobs',
      viewAccounts: 'Accounts',
      viewContacts: 'Contacts',
      viewJobs: 'Jobs',
      viewAdmin: 'Admin',
    },
    jobseeker: {
      eyebrow: 'Job search intelligence',
      topbarEyebrow: 'Your intelligent job search command center',
      brandCopy: 'Track target companies, hiring contacts, and open roles to land your next opportunity.',
      navDashboard: 'Dashboard',
      navAccounts: 'Companies',
      navContacts: 'Hiring Contacts',
      navJobs: 'Open Roles',
      navAdmin: 'Settings',
      searchPlaceholder: 'Type a company, contact, or role',
      searchLabel: 'Search companies, contacts, roles',
      viewAccounts: 'Companies',
      viewContacts: 'Hiring Contacts',
      viewJobs: 'Open Roles',
      viewAdmin: 'Settings',
    },
  };

  // Text replacements that apply within rendered HTML content
  const TEXT_SWAPS = {
    jobseeker: [
      ['Accounts', 'Companies'],
      ['accounts', 'companies'],
      ['Contacts', 'Hiring Contacts'],
      ['Jobs', 'Open Roles'],
    ],
  };

  let currentPersona = 'bd';
  let applied = false;

  function getLabels() {
    return LABELS[currentPersona] || LABELS.bd;
  }

  function applyLabels() {
    const labels = getLabels();

    // Sidebar brand
    const sidebarEyebrow = document.querySelector('.sidebar .eyebrow');
    if (sidebarEyebrow) sidebarEyebrow.textContent = labels.eyebrow;
    const brandCopy = document.querySelector('.sidebar .brand-copy');
    if (brandCopy) brandCopy.textContent = labels.brandCopy;

    // Nav items
    const navRoutes = {
      dashboard: 'navDashboard',
      accounts: 'navAccounts',
      contacts: 'navContacts',
      jobs: 'navJobs',
      admin: 'navAdmin',
    };
    for (const [route, key] of Object.entries(navRoutes)) {
      const el = document.querySelector(`.nav a[data-route="${route}"] .nav-label`);
      if (el) el.textContent = labels[key];
    }

    // Topbar eyebrow
    const topbarEyebrow = document.querySelector('.topbar .eyebrow');
    if (topbarEyebrow) topbarEyebrow.textContent = labels.topbarEyebrow;

    // Search
    const searchShell = document.querySelector('.search-shell span');
    if (searchShell) {
      const kbd = searchShell.querySelector('kbd');
      const kbdHtml = kbd ? ` ${kbd.outerHTML}` : '';
      searchShell.innerHTML = `${labels.searchLabel}${kbdHtml}`;
    }
    const searchInput = document.getElementById('global-search-input');
    if (searchInput) searchInput.placeholder = labels.searchPlaceholder;

    // View title — swap known titles
    const viewTitle = document.getElementById('view-title');
    if (viewTitle && currentPersona === 'jobseeker') {
      const titleMap = { 'Accounts': 'Companies', 'Contacts': 'Hiring Contacts', 'Jobs': 'Open Roles', 'Admin': 'Settings' };
      if (titleMap[viewTitle.textContent]) {
        viewTitle.textContent = titleMap[viewTitle.textContent];
      }
    }

    // Breadcrumbs — swap text
    if (currentPersona === 'jobseeker') {
      document.querySelectorAll('#breadcrumbs a, #breadcrumbs span').forEach((el) => {
        const swapMap = { 'Accounts': 'Companies', 'Contacts': 'Hiring Contacts', 'Jobs': 'Open Roles', 'Admin': 'Settings' };
        if (swapMap[el.textContent]) el.textContent = swapMap[el.textContent];
      });
    }

    applied = true;
  }

  // Detect persona from the bootstrap API response
  function detectPersona() {
    // Check if the app has loaded bootstrap data
    if (window.__bdPersona) {
      currentPersona = window.__bdPersona;
      return true;
    }

    // Try to detect from fetch responses by intercepting
    return false;
  }

  // Intercept fetch to capture persona from bootstrap/me responses
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    if (url.includes('/api/bootstrap') || url.includes('/api/auth/me')) {
      try {
        const clone = response.clone();
        const data = await clone.json();
        if (data.persona) {
          currentPersona = data.persona;
          window.__bdPersona = data.persona;
          // Re-apply labels when persona is detected
          requestAnimationFrame(() => applyLabels());
        }
      } catch {
        // Ignore parse errors
      }
    }
    return response;
  };

  // Use MutationObserver to re-apply labels when the DOM changes (view switches)
  const observer = new MutationObserver(() => {
    if (currentPersona !== 'bd') {
      applyLabels();
    }
  });

  // Start observing once the app shell is ready
  function startObserving() {
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('.main');

    if (sidebar) {
      observer.observe(sidebar, { childList: true, subtree: true, characterData: true });
    }
    if (main) {
      observer.observe(main, { childList: true, subtree: true });
    }

    // Initial apply
    applyLabels();
  }

  // Wait for app to be ready
  if (document.readyState === 'complete') {
    setTimeout(startObserving, 500);
  } else {
    window.addEventListener('load', () => setTimeout(startObserving, 500));
  }

  // Also apply on hash changes (route switches)
  window.addEventListener('hashchange', () => {
    if (currentPersona !== 'bd') {
      setTimeout(applyLabels, 100);
    }
  });
})();
