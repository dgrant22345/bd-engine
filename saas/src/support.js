const CATEGORIES = new Set(['job_discovery', 'data_import', 'outreach', 'billing', 'account', 'feedback', 'other']);
const STATUSES = new Set(['new', 'open', 'waiting_on_customer', 'resolved', 'closed']);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

function cleanText(value, maxLength) {
  return String(value || '').trim().replace(/\r\n/g, '\n').slice(0, maxLength);
}

export function validateSupportTicketInput(input = {}) {
  const category = CATEGORIES.has(input.category) ? input.category : 'other';
  const subject = cleanText(input.subject, 120);
  const body = cleanText(input.body, 5000);
  const pageUrl = cleanText(input.pageUrl, 500);
  if (subject.length < 5) return { error: 'Add a short subject so we can route your request.' };
  if (body.length < 10) return { error: 'Tell us a little more about what happened or what you need.' };
  return { value: { category, subject, body, pageUrl } };
}

export function validateSupportReplyInput(input = {}) {
  const body = cleanText(input.body, 5000);
  if (body.length < 2) return { error: 'Add a message before sending your reply.' };
  return { value: { body, internal: Boolean(input.internal) } };
}

export function validateSupportAdminUpdate(input = {}, current = {}) {
  const status = STATUSES.has(input.status) ? input.status : current.status;
  const priority = PRIORITIES.has(input.priority) ? input.priority : current.priority;
  const assignedToUserId = cleanText(input.assignedToUserId ?? current.assignedToUserId, 120);
  if (!status || !priority) return { error: 'Choose a valid status and priority.' };
  return { value: { status, priority, assignedToUserId } };
}

export function publicSupportTicket(ticket = {}, { operator = false } = {}) {
  const messages = Array.isArray(ticket.messages)
    ? ticket.messages.filter((message) => operator || !message.internal)
    : [];
  const result = {
    id: ticket.id,
    category: ticket.category,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    resolvedAt: ticket.resolvedAt,
    messages: messages.map((message) => ({
      id: message.id,
      authorType: message.authorType,
      body: message.body,
      internal: operator ? Boolean(message.internal) : undefined,
      createdAt: message.createdAt,
    })),
  };
  if (operator) {
    result.tenantId = ticket.tenantId;
    result.createdByUserId = ticket.createdByUserId;
    result.assignedToUserId = ticket.assignedToUserId;
    result.pageUrl = ticket.pageUrl;
    result.userAgent = ticket.userAgent;
  }
  return result;
}

export const SUPPORT_STATUSES = STATUSES;

