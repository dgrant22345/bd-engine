export const COMMERCIAL_OUTCOME_STAGES = Object.freeze([
  'outreach_logged',
  'replied',
  'positive_reply',
  'meeting_booked',
  'opportunity_created',
  'won',
  'lost',
]);

export const COMMERCIAL_OUTCOME_STAGE_SET = new Set(COMMERCIAL_OUTCOME_STAGES);

const COMMERCIAL_OUTCOME_SOURCES = new Set(['manual', 'activity', 'import', 'integration']);
const MAX_VALUE_CENTS = 9_000_000_000_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export class CommercialOutcomeValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'CommercialOutcomeValidationError';
    this.status = status;
  }
}

function boundedText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeTimestamp(value, { field = 'occurredAt', allowEmpty = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw && allowEmpty) return '';
  const timestamp = new Date(raw || Date.now());
  if (Number.isNaN(timestamp.getTime())) {
    throw new CommercialOutcomeValidationError(`${field} must be a valid date and time.`);
  }
  if (field === 'occurredAt' && timestamp.getTime() > Date.now() + MAX_FUTURE_SKEW_MS) {
    throw new CommercialOutcomeValidationError('occurredAt cannot be in the future.');
  }
  return timestamp.toISOString();
}

export function validateCommercialOutcomeInput(payload = {}) {
  const stage = boundedText(payload.stage, 40).toLowerCase();
  if (!COMMERCIAL_OUTCOME_STAGE_SET.has(stage)) {
    throw new CommercialOutcomeValidationError(
      `stage must be one of: ${COMMERCIAL_OUTCOME_STAGES.join(', ')}.`
    );
  }

  const accountId = boundedText(payload.accountId, 120);
  if (!accountId) throw new CommercialOutcomeValidationError('accountId is required.');

  let valueCents = null;
  if (payload.valueCents !== undefined && payload.valueCents !== null && payload.valueCents !== '') {
    valueCents = Number(payload.valueCents);
    if (!Number.isSafeInteger(valueCents) || valueCents < 0 || valueCents > MAX_VALUE_CENTS) {
      throw new CommercialOutcomeValidationError('valueCents must be a non-negative integer in the supported range.');
    }
  }

  const currency = boundedText(payload.currency || 'USD', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new CommercialOutcomeValidationError('currency must be a three-letter ISO currency code.');
  }

  const lostReason = boundedText(payload.lostReason, 240);
  if (lostReason && stage !== 'lost') {
    throw new CommercialOutcomeValidationError('lostReason can only be recorded for a lost outcome.');
  }

  const source = boundedText(payload.source || 'manual', 24).toLowerCase();
  if (!COMMERCIAL_OUTCOME_SOURCES.has(source)) {
    throw new CommercialOutcomeValidationError('source must be manual, activity, import, or integration.');
  }

  return {
    stage,
    accountId,
    contactId: boundedText(payload.contactId, 120),
    valueCents,
    currency,
    lostReason,
    notes: boundedText(payload.notes, 2000),
    source,
    sourceActivityId: boundedText(payload.sourceActivityId, 120),
    occurredAt: normalizeTimestamp(payload.occurredAt, { field: 'occurredAt' }),
  };
}

export function validateCommercialOutcomeQuery(query = {}, { maxPageSize = 100 } = {}) {
  const stage = boundedText(query.stage, 40).toLowerCase();
  if (stage && !COMMERCIAL_OUTCOME_STAGE_SET.has(stage)) {
    throw new CommercialOutcomeValidationError(
      `stage must be one of: ${COMMERCIAL_OUTCOME_STAGES.join(', ')}.`
    );
  }
  const from = normalizeTimestamp(query.from, { field: 'from', allowEmpty: true });
  const to = normalizeTimestamp(query.to, { field: 'to', allowEmpty: true });
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new CommercialOutcomeValidationError('from must be before to.');
  }

  return {
    stage,
    accountId: boundedText(query.accountId, 120),
    contactId: boundedText(query.contactId, 120),
    from,
    to,
    page: Math.max(1, Math.floor(Number(query.page) || 1)),
    pageSize: Math.max(1, Math.min(maxPageSize, Math.floor(Number(query.pageSize) || 25))),
  };
}

function safeRate(numerator, denominator) {
  if (!denominator) return null;
  return Math.round(Math.min(1, numerator / denominator) * 10000) / 10000;
}

export function summarizeCommercialOutcomes(items = []) {
  const byStage = Object.fromEntries(COMMERCIAL_OUTCOME_STAGES.map((stage) => [stage, 0]));
  const valuesByCurrency = {};
  const accounts = new Set();
  let firstOccurredAt = '';
  let lastOccurredAt = '';

  for (const item of items) {
    if (!COMMERCIAL_OUTCOME_STAGE_SET.has(item?.stage)) continue;
    byStage[item.stage] += 1;
    if (item.accountId) accounts.add(item.accountId);
    const occurredAt = String(item.occurredAt || '');
    if (occurredAt && (!firstOccurredAt || occurredAt < firstOccurredAt)) firstOccurredAt = occurredAt;
    if (occurredAt && (!lastOccurredAt || occurredAt > lastOccurredAt)) lastOccurredAt = occurredAt;

    if (item.valueCents !== null && item.valueCents !== undefined) {
      const currency = String(item.currency || 'USD').toUpperCase();
      valuesByCurrency[currency] ||= {
        opportunityCreatedCents: 0,
        wonCents: 0,
        lostCents: 0,
      };
      if (item.stage === 'opportunity_created') valuesByCurrency[currency].opportunityCreatedCents += Number(item.valueCents || 0);
      if (item.stage === 'won') valuesByCurrency[currency].wonCents += Number(item.valueCents || 0);
      if (item.stage === 'lost') valuesByCurrency[currency].lostCents += Number(item.valueCents || 0);
    }
  }

  const responseCount = byStage.replied + byStage.positive_reply;
  return {
    total: Object.values(byStage).reduce((sum, count) => sum + count, 0),
    uniqueAccounts: accounts.size,
    byStage,
    valuesByCurrency,
    conversion: {
      outreachToReplyRate: safeRate(responseCount, byStage.outreach_logged),
      replyToPositiveRate: safeRate(byStage.positive_reply, responseCount),
      positiveReplyToMeetingRate: safeRate(byStage.meeting_booked, byStage.positive_reply),
      meetingToOpportunityRate: safeRate(byStage.opportunity_created, byStage.meeting_booked),
      opportunityToWinRate: safeRate(byStage.won, byStage.opportunity_created),
    },
    firstOccurredAt: firstOccurredAt || null,
    lastOccurredAt: lastOccurredAt || null,
  };
}

export function productEventTypeForOutcomeStage(stage) {
  return ({
    outreach_logged: 'outreach_logged',
    replied: 'reply_received',
    positive_reply: 'positive_reply_received',
    meeting_booked: 'meeting_booked',
    opportunity_created: 'opportunity_created',
    won: 'client_won',
    lost: 'client_lost',
  })[stage] || '';
}

export function outcomeStageForActivity(payload = {}) {
  const pipelineStage = boundedText(payload.pipelineStage, 40).toLowerCase();
  if (pipelineStage === 'replied') return 'replied';
  if (pipelineStage === 'opportunity') return 'opportunity_created';
  if (pipelineStage === 'contacted' || boundedText(payload.type, 40).toLowerCase() === 'outreach') {
    return 'outreach_logged';
  }
  return '';
}
