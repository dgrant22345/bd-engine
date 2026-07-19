function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function configRank(config = {}) {
  const status = normalizeKey(config.discoveryStatus);
  const reviewStatus = normalizeKey(config.reviewStatus);
  const confidence = normalizeKey(config.confidenceBand);
  const resolved = ['resolved', 'mapped', 'discovered', 'manual'].includes(status) || reviewStatus === 'approved';
  return (
    (config.active === false ? 0 : 1000)
    + (resolved ? 500 : 0)
    + ({ high: 30, medium: 20, low: 10 }[confidence] || 0)
  );
}

function compareConfigs(a, b) {
  return configRank(b) - configRank(a)
    || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    || String(a.id || '').localeCompare(String(b.id || ''));
}

function accountNames(account = {}) {
  return [account.normalizedName, account.displayName, ...(Array.isArray(account.aliases) ? account.aliases : [])]
    .map(normalizeKey)
    .filter(Boolean);
}

export function decorateAccountsWithConfigs(accountRows = [], configRows = []) {
  const accounts = Array.isArray(accountRows) ? accountRows : [];
  const configs = Array.isArray(configRows) ? configRows : [];
  const accountIds = new Set(accounts.map((item) => item.id).filter(Boolean));
  const configsByAccountId = new Map();
  const configsByName = new Map();

  for (const config of configs) {
    if (config.accountId && accountIds.has(config.accountId)) {
      const linked = configsByAccountId.get(config.accountId) || [];
      linked.push(config);
      configsByAccountId.set(config.accountId, linked);
      continue;
    }
    if (config.accountId) continue;
    const name = normalizeKey(config.normalizedCompanyName || config.companyName);
    if (!name) continue;
    const linked = configsByName.get(name) || [];
    linked.push(config);
    configsByName.set(name, linked);
  }

  return accounts.map((account) => {
    const linkedById = configsByAccountId.get(account.id) || [];
    const linkedByName = accountNames(account).flatMap((name) => configsByName.get(name) || []);
    const uniqueConfigs = [...new Map([...linkedById, ...linkedByName].map((config) => [config.id, config])).values()]
      .sort(compareConfigs);
    const primaryConfig = uniqueConfigs[0] || null;
    const atsTypes = [...new Set(uniqueConfigs
      .map((config) => normalizeKey(config.atsType || config.ats))
      .filter((value) => value && value !== 'unknown'))];
    const resolved = primaryConfig && (
      ['resolved', 'mapped', 'discovered', 'manual'].includes(normalizeKey(primaryConfig.discoveryStatus))
      || normalizeKey(primaryConfig.reviewStatus) === 'approved'
    );

    return {
      ...account,
      atsTypes,
      primaryConfigId: primaryConfig?.id || '',
      configCount: uniqueConfigs.length,
      configDiscoveryStatus: primaryConfig?.discoveryStatus || account.configDiscoveryStatus || (atsTypes.length ? 'discovered' : 'missing_inputs'),
      configReviewStatus: primaryConfig?.reviewStatus || account.configReviewStatus || '',
      configConfidenceBand: primaryConfig?.confidenceBand || account.configConfidenceBand || '',
      canonicalDomain: account.canonicalDomain || account.domain || primaryConfig?.domain || '',
      careersUrl: account.careersUrl || primaryConfig?.careersUrl || primaryConfig?.resolvedBoardUrl || '',
      enrichmentStatus: account.enrichmentStatus || (resolved ? 'enriched' : uniqueConfigs.length ? 'needs_review' : 'missing_inputs'),
      enrichmentConfidence: account.enrichmentConfidence || primaryConfig?.confidenceBand || (resolved ? 'high' : 'unresolved'),
      reviewReason: account.reviewReason || account.enrichmentFailureReason || primaryConfig?.lastImportError || '',
    };
  });
}
