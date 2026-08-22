import { createHash } from 'node:crypto';

export const PRODUCT_EVENT_TYPES = new Set([
  'signup_completed',
  'setup_completed',
  'target_created',
  'outreach_generated',
  'discovery_started',
  'board_resolved',
  'job_import_started',
  'useful_jobs_found',
  'outreach_logged',
  'reply_received',
  'positive_reply_received',
  'meeting_booked',
  'opportunity_created',
  'client_won',
  'client_lost',
  'checkout_started',
  'subscription_started',
  'subscription_canceled',
  'payment_failed',
  'payment_recovered',
]);

const ACQUISITION_TOKEN_DIMENSIONS = new Set([
  'source',
  'mode',
  'firstTouchSource',
  'firstTouchMedium',
  'firstTouchCampaign',
  'firstTouchContent',
  'lastNonDirectSource',
  'lastNonDirectMedium',
  'lastNonDirectCampaign',
  'lastNonDirectContent',
]);

const ACQUISITION_PATH_DIMENSIONS = new Set([
  'firstTouchLandingPath',
  'lastNonDirectLandingPath',
]);

const ACQUISITION_PERSONA_DIMENSIONS = new Set([
  'persona',
  'firstTouchPersona',
  'lastNonDirectPersona',
]);

const ALLOWED_DIMENSIONS = new Set([
  ...ACQUISITION_TOKEN_DIMENSIONS,
  ...ACQUISITION_PATH_DIMENSIONS,
  ...ACQUISITION_PERSONA_DIMENSIONS,
  'planId',
  'termsVersion',
  'privacyVersion',
]);

const PUBLIC_ACQUISITION_PATHS = new Set(['/', '/job-search', '/ats-checker']);

export function buildAcquisitionSource(acquisition = {}, fallback = 'direct') {
  const attribution = normalizeAcquisitionAttribution(acquisition, fallback);
  const touch = attribution.lastNonDirectTouch?.source
    ? attribution.lastNonDirectTouch
    : attribution.firstTouch;
  const source = sanitizeAcquisitionToken(touch?.source || fallback) || 'direct';
  const campaign = sanitizeAcquisitionToken(touch?.campaign);
  return (campaign && campaign !== source ? `${source}.${campaign}` : source).slice(0, 48);
}

export function buildAcquisitionDimensions(acquisition = {}, {
  persona = '',
  forceLastNonDirectSource = '',
} = {}) {
  const attribution = normalizeAcquisitionAttribution(acquisition);
  const firstTouch = attribution.firstTouch;
  let lastNonDirectTouch = attribution.lastNonDirectTouch;
  const forcedSource = sanitizeAcquisitionToken(forceLastNonDirectSource);
  if (forcedSource && forcedSource !== 'direct') {
    lastNonDirectTouch = {
      source: forcedSource,
      landingPath: lastNonDirectTouch.landingPath || firstTouch.landingPath,
      persona: normalizePersona(lastNonDirectTouch.persona || firstTouch.persona || persona),
    };
  }

  const dimensions = {
    persona: normalizePersona(persona),
    source: buildTouchSource(lastNonDirectTouch?.source ? lastNonDirectTouch : firstTouch),
  };
  appendTouchDimensions(dimensions, 'firstTouch', firstTouch);
  appendTouchDimensions(dimensions, 'lastNonDirect', lastNonDirectTouch);
  return Object.fromEntries(Object.entries(dimensions).filter(([, value]) => value));
}

function normalizeAcquisitionAttribution(acquisition = {}, fallback = 'direct') {
  const input = acquisition && typeof acquisition === 'object' && !Array.isArray(acquisition)
    ? acquisition
    : {};
  const legacyTouch = normalizeAcquisitionTouch(input);
  const firstTouch = normalizeAcquisitionTouch(
    input.firstTouch && typeof input.firstTouch === 'object' ? input.firstTouch : legacyTouch,
    fallback,
  );
  const lastCandidate = input.lastNonDirectTouch && typeof input.lastNonDirectTouch === 'object'
    ? input.lastNonDirectTouch
    : (legacyTouch.source && legacyTouch.source !== 'direct' ? legacyTouch : {});
  const lastNonDirectTouch = normalizeAcquisitionTouch(lastCandidate);
  if (lastNonDirectTouch.source === 'direct') return { firstTouch, lastNonDirectTouch: {} };
  return { firstTouch, lastNonDirectTouch };
}

function normalizeAcquisitionTouch(touch = {}, fallbackSource = '') {
  const source = sanitizeAcquisitionToken(touch?.source || fallbackSource);
  const medium = sanitizeAcquisitionToken(touch?.medium);
  const campaign = sanitizeAcquisitionToken(touch?.campaign);
  const content = sanitizeAcquisitionToken(touch?.content);
  const landingPath = sanitizeAcquisitionLandingPath(touch?.landingPath);
  const persona = normalizePersona(touch?.persona);
  return Object.fromEntries(Object.entries({
    source,
    medium,
    campaign,
    content,
    landingPath,
    persona,
  }).filter(([, value]) => value));
}

function appendTouchDimensions(dimensions, prefix, touch = {}) {
  if (!touch?.source) return;
  dimensions[`${prefix}Source`] = touch.source;
  dimensions[`${prefix}Medium`] = touch.medium || '';
  dimensions[`${prefix}Campaign`] = touch.campaign || '';
  dimensions[`${prefix}Content`] = touch.content || '';
  dimensions[`${prefix}LandingPath`] = touch.landingPath || '';
  dimensions[`${prefix}Persona`] = touch.persona || '';
}

function buildTouchSource(touch = {}) {
  const source = sanitizeAcquisitionToken(touch.source) || 'direct';
  const campaign = sanitizeAcquisitionToken(touch.campaign);
  return (campaign && campaign !== source ? `${source}.${campaign}` : source).slice(0, 48);
}

function hashIdentifier(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function sanitizeAcquisitionToken(value) {
  const raw = String(value || '').trim();
  if (raw.includes('@') || /(?:[a-z]+:\/\/|[\\/?#])/i.test(raw)) return '';
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 32);
}

function sanitizeAcquisitionLandingPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const pathname = new URL(raw, 'https://bd-engine.local').pathname.replace(/\/+$/, '') || '/';
    return PUBLIC_ACQUISITION_PATHS.has(pathname) ? pathname : '';
  } catch {
    return '';
  }
}

function normalizePersona(value) {
  return value === 'jobseeker' ? 'jobseeker' : (value === 'bd' ? 'bd' : '');
}

function normalizeDimensionValue(key, value) {
  if (ACQUISITION_TOKEN_DIMENSIONS.has(key)) return sanitizeAcquisitionToken(value);
  if (ACQUISITION_PATH_DIMENSIONS.has(key)) return sanitizeAcquisitionLandingPath(value);
  if (ACQUISITION_PERSONA_DIMENSIONS.has(key)) return normalizePersona(value);
  return String(value || '').slice(0, 48);
}

export function buildProductEvent({ eventType, tenantId = '', userId = '', eventKey = '', dimensions = {} } = {}) {
  if (!PRODUCT_EVENT_TYPES.has(eventType)) throw new Error(`Unsupported product event: ${eventType}`);
  const metadata = {};
  for (const [key, value] of Object.entries(dimensions || {})) {
    if (!ALLOWED_DIMENSIONS.has(key)) continue;
    const normalized = normalizeDimensionValue(key, value);
    if (normalized) metadata[key] = normalized;
  }
  const subject = userId || tenantId || 'anonymous';
  return {
    visitorId: `product-${hashIdentifier(subject).slice(0, 32)}`,
    eventType,
    path: `/funnel/${eventType.replace(/_/g, '-')}`,
    source: 'product',
    tenantId,
    userId,
    eventKey: hashIdentifier(`${eventType}:${eventKey || tenantId || userId}`),
    metadata,
  };
}
