(() => {
  const responseCache = new Map();
  const inflightRequests = new Map();

  function cloneValue(value) {
    if (value === null || value === undefined) return value;
    if (typeof window.structuredClone === 'function') {
      return window.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function getMethod(options = {}) {
    return String(options.method || 'GET').toUpperCase();
  }

  function getCacheKey(path, options = {}) {
    return `${getMethod(options)}:${path}`;
  }

  function invalidateCache() {
    responseCache.clear();
  }

  async function remoteApi(path, options = {}) {
    const method = getMethod(options);
    const useCache = method === 'GET' && !options.skipCache;
    const cacheKey = useCache ? getCacheKey(path, options) : '';

    if (useCache && responseCache.has(cacheKey)) {
      return cloneValue(responseCache.get(cacheKey));
    }

    // Deduplicate identical in-flight GET requests
    if (useCache && inflightRequests.has(cacheKey)) {
      const payload = await inflightRequests.get(cacheKey);
      return cloneValue(payload);
    }

    const fetchPromise = (async () => {
      const response = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        ...options,
      });

      if (!response.ok) {
        let message = `Request failed: ${response.status}`;
        try {
          const payload = await response.json();
          message = payload.error || payload.details || message;
        } catch (_error) {
          // Ignore non-JSON error bodies.
        }
        throw new Error(message);
      }

      return response.status === 204 ? null : await response.json();
    })();

    if (useCache) {
      inflightRequests.set(cacheKey, fetchPromise);
    }

    try {
      const payload = await fetchPromise;
      if (method === 'GET' && useCache) {
        responseCache.set(cacheKey, payload);
      } else if (method !== 'GET') {
        invalidateCache();
      }
      return cloneValue(payload);
    } finally {
      if (useCache) {
        inflightRequests.delete(cacheKey);
      }
    }
  }

  async function loadBootstrap(appState, force = false, options = {}) {
    const includeFilters = Boolean(options.includeFilters);
    const hasBootstrap = Boolean(appState.bootstrap);
    const hasNeededFilters = !includeFilters || Boolean(appState.bootstrap?.filters);

    if (hasBootstrap && !force && hasNeededFilters) {
      return appState.bootstrap;
    }

    const query = includeFilters ? '?includeFilters=true' : '';
    const payload = await remoteApi(`/api/bootstrap${query}`, { skipCache: force });
    appState.bootstrap = {
      ...(appState.bootstrap || {}),
      ...payload,
    };
    return appState.bootstrap;
  }

  function setAlert(message, alertElement) {
    if (!alertElement) return;
    if (!message) {
      alertElement.textContent = '';
      alertElement.classList.add('hidden');
      return;
    }

    alertElement.textContent = String(message);
    alertElement.classList.remove('hidden');
  }

  function handleError(error, alertElement) {
    const message = error && error.message ? error.message : String(error || 'Something went wrong.');
    console.error(error);
    setAlert(message, alertElement);
  }

  window.bdLocalApi = {
    api(_appState, path, options = {}) {
      return remoteApi(path, options);
    },
    invalidate: invalidateCache,
    loadBootstrap,
    handleError,
    setAlert,
  };
})();
