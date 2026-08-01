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
  'checkout_started',
  'subscription_started',
  'subscription_canceled',
  'payment_failed',
  'payment_recovered',
]);

const ALLOWED_DIMENSIONS = new Set(['persona', 'planId', 'source', 'mode']);

export function buildAcquisitionSource(acquisition = {}, fallback = 'direct') {
  const source = sanitizeAcquisitionToken(acquisition.source || fallback) || 'direct';
  const campaign = sanitizeAcquisitionToken(acquisition.campaign);
  return (campaign && campaign !== source ? `${source}.${campaign}` : source).slice(0, 48);
}

function hashIdentifier(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function sanitizeAcquisitionToken(value) {
  const raw = String(value || '').trim();
  if (raw.includes('@')) return '';
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 32);
}

export function buildProductEvent({ eventType, tenantId = '', userId = '', eventKey = '', dimensions = {} } = {}) {
  if (!PRODUCT_EVENT_TYPES.has(eventType)) throw new Error(`Unsupported product event: ${eventType}`);
  const metadata = {};
  for (const [key, value] of Object.entries(dimensions || {})) {
    if (!ALLOWED_DIMENSIONS.has(key)) continue;
    metadata[key] = String(value || '').slice(0, 48);
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
