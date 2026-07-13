import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dbCreateSupportTicket,
  dbListSupportTickets,
  dbGetSupportTicket,
  dbAddSupportTicketMessage,
  dbUpdateSupportTicket,
} from '../src/db.js';
import {
  validateSupportTicketInput,
  validateSupportReplyInput,
  validateSupportAdminUpdate,
  publicSupportTicket,
} from '../src/support.js';

test('support request validation keeps customer input bounded and actionable', () => {
  assert.match(validateSupportTicketInput({ subject: 'Help', body: 'short' }).error, /subject/i);
  assert.match(validateSupportTicketInput({ subject: 'Import failed', body: 'short' }).error, /more/i);

  const valid = validateSupportTicketInput({
    category: 'data_import',
    subject: ' LinkedIn import stopped ',
    body: ' The import stopped after the first row. ',
    pageUrl: 'https://example.com/app/#/setup',
  });
  assert.deepEqual(valid.value, {
    category: 'data_import',
    subject: 'LinkedIn import stopped',
    body: 'The import stopped after the first row.',
    pageUrl: 'https://example.com/app/#/setup',
  });
  assert.match(validateSupportReplyInput({ body: '' }).error, /message/i);
});

test('support tickets preserve conversations and reopen when a customer replies', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tenantId = `tenant-support-${suffix}`;
  const userId = `user-support-${suffix}`;
  const ticketId = `support-${suffix}`;
  const createdAt = new Date().toISOString();

  const created = await dbCreateSupportTicket({
    id: ticketId,
    tenantId,
    createdByUserId: userId,
    category: 'job_discovery',
    subject: 'ATS was not detected',
    status: 'new',
    priority: 'normal',
    createdAt,
    updatedAt: createdAt,
  }, {
    ticketId,
    tenantId,
    authorUserId: userId,
    authorType: 'customer',
    body: 'The careers page is public but no board was found.',
    createdAt,
  });
  assert.equal(created.messages.length, 1);

  const tenantTickets = await dbListSupportTickets({ tenantId, createdByUserId: userId });
  assert.equal(tenantTickets.some((ticket) => ticket.id === ticketId), true);
  assert.equal(await dbGetSupportTicket(ticketId, { tenantId: 'another-tenant' }), null);

  await dbAddSupportTicketMessage({
    ticketId,
    authorUserId: 'operator-1',
    authorType: 'support',
    body: 'We are checking the careers page now.',
    internal: false,
    allTenants: true,
  });
  let ticket = await dbGetSupportTicket(ticketId, { tenantId, createdByUserId: userId });
  assert.equal(ticket.status, 'waiting_on_customer');

  await dbAddSupportTicketMessage({
    ticketId,
    tenantId,
    authorUserId: userId,
    authorType: 'customer',
    body: 'The careers page URL is in the request.',
  });
  ticket = await dbGetSupportTicket(ticketId, { tenantId, createdByUserId: userId });
  assert.equal(ticket.status, 'open');
  assert.equal(ticket.messages.length, 3);

  const adminUpdate = validateSupportAdminUpdate({ status: 'resolved', priority: 'high' }, ticket);
  const resolved = await dbUpdateSupportTicket(ticketId, adminUpdate.value);
  assert.equal(resolved.status, 'resolved');
  assert.match(resolved.resolvedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('customer support payloads never expose internal notes or operator metadata', () => {
  const ticket = {
    id: 'support-private',
    tenantId: 'tenant-private',
    createdByUserId: 'user-private',
    userAgent: 'secret-agent',
    category: 'billing',
    subject: 'Billing question',
    status: 'open',
    priority: 'normal',
    messages: [
      { id: '1', authorType: 'customer', body: 'Can you help?', internal: false, createdAt: '2026-07-13T00:00:00.000Z' },
      { id: '2', authorType: 'support', body: 'Internal context', internal: true, createdAt: '2026-07-13T00:01:00.000Z' },
    ],
  };
  const customer = publicSupportTicket(ticket);
  assert.equal(customer.messages.length, 1);
  assert.equal(customer.tenantId, undefined);
  assert.equal(customer.userAgent, undefined);
  assert.equal(JSON.stringify(customer).includes('Internal context'), false);
});

