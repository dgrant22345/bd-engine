// Team workspaces: who may invite, change and remove members, and the
// invitations that bring a teammate in.
//
// An invitation is single-use, bound to one email address and valid for seven
// days. Only a SHA-256 hash of its token is stored. Accepting needs the token
// and an account with the invited address; an invited signup is the only path
// that creates that account, and the token (which was only ever emailed to the
// address) proves the mailbox.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dbQuery, dbTransaction, isDbEnabled } from './db.js';

export const INVITABLE_ROLES = Object.freeze(['admin', 'member']);
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const EMAIL_RE = /^[^\s@<>()[\]",;:\\]+@[^\s@<>()[\]",;:\\]+\.[^\s@<>()[\]",;:\\]{2,}$/;

export function normalizeInviteEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isValidInviteEmail(value) {
  const email = normalizeInviteEmail(value);
  return email.length > 5 && email.length <= 254 && EMAIL_RE.test(email);
}

export function newInvitationToken() {
  return randomBytes(32).toString('base64url');
}

export function hashInvitationToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

// ── Rules ───────────────────────────────────────────────────────────────────
// Roles: owner (one per workspace), admin, member. Viewer is the read-only
// demo role and has no team rights.

export function canManageTeam(role) {
  return role === 'owner' || role === 'admin';
}

// The owner invites admins and members; an admin invites members.
export function canInvite(actorRole, role) {
  if (!INVITABLE_ROLES.includes(role)) return false;
  if (actorRole === 'owner') return true;
  return actorRole === 'admin' && role === 'member';
}

export function canRevokeInvitation(actorRole, invitation) {
  return canInvite(actorRole, invitation?.role);
}

// Only the owner changes roles, never their own and never to or from owner.
export function canChangeRole(actor, target, nextRole) {
  if (!actor || !target || actor.userId === target.userId) return false;
  if (actor.role !== 'owner' || target.role === 'owner') return false;
  return INVITABLE_ROLES.includes(nextRole);
}

// Anyone but the owner may leave. The owner removes admins and members; an
// admin removes members. Nobody removes the owner.
export function canRemoveMember(actor, target) {
  if (!actor || !target || target.role === 'owner') return false;
  if (actor.userId === target.userId) return true;
  if (actor.role === 'owner') return true;
  return actor.role === 'admin' && target.role === 'member';
}

// Members plus pending invitations count against the plan's users limit
// (-1 is unlimited).
export function seatSummary({ members = 0, pending = 0, limit = 1 } = {}) {
  const unlimited = Number(limit) < 0;
  return {
    members,
    pending,
    limit: unlimited ? 'unlimited' : Number(limit),
    available: unlimited ? null : Math.max(0, Number(limit) - members - pending),
  };
}

export function invitationStatus(invitation, now = new Date()) {
  if (!invitation) return 'invalid';
  if (invitation.revokedAt) return 'revoked';
  if (invitation.acceptedAt) return 'accepted';
  if (Date.parse(invitation.expiresAt) <= now.getTime()) return 'expired';
  return 'pending';
}

// What the inviter and the team list see. The token hash never leaves the server.
export function publicInvitation(invitation) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    invitedByUserId: invitation.invitedByUserId,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
  };
}

// ── Store ───────────────────────────────────────────────────────────────────

const fromRow = (row) => row && ({
  id: row.id,
  tenantId: row.tenant_id,
  email: row.email,
  role: row.role,
  tokenHash: row.token_hash,
  invitedByUserId: row.invited_by_user_id,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  acceptedAt: row.accepted_at,
  acceptedByUserId: row.accepted_by_user_id,
  revokedAt: row.revoked_at,
});

export function createInvitationStore({ query = dbQuery, transaction = dbTransaction, enabled = isDbEnabled, now = () => new Date() } = {}) {
  const memory = new Map();
  const pendingOf = (items, tenantId) => items.filter((item) => item.tenantId === tenantId && invitationStatus(item, now()) === 'pending');

  return {
    // A new invitation replaces any pending one for the same address.
    async create({ tenantId, email, role, invitedByUserId }) {
      const token = newInvitationToken();
      const createdAt = now();
      const invitation = {
        id: `invite-${randomUUID()}`,
        tenantId,
        email: normalizeInviteEmail(email),
        role,
        tokenHash: hashInvitationToken(token),
        invitedByUserId,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + INVITATION_TTL_MS).toISOString(),
        acceptedAt: '',
        acceptedByUserId: '',
        revokedAt: '',
      };
      if (!enabled()) {
        for (const item of pendingOf([...memory.values()], tenantId)) {
          if (item.email === invitation.email) item.revokedAt = invitation.createdAt;
        }
        memory.set(invitation.id, invitation);
        return { invitation: { ...invitation }, token };
      }
      await transaction(async (tx) => {
        await tx(`UPDATE workspace_invitations SET revoked_at=$3
          WHERE tenant_id=$1 AND email=$2 AND accepted_at='' AND revoked_at=''`, [tenantId, invitation.email, invitation.createdAt]);
        await tx(`INSERT INTO workspace_invitations (id, tenant_id, email, role, token_hash, invited_by_user_id, created_at, expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [invitation.id, tenantId, invitation.email, role, invitation.tokenHash, invitedByUserId, invitation.createdAt, invitation.expiresAt]);
      });
      return { invitation, token };
    },

    async listPending(tenantId) {
      if (!enabled()) return pendingOf([...memory.values()], tenantId).map((item) => ({ ...item }));
      const { rows } = await query(`SELECT * FROM workspace_invitations
        WHERE tenant_id=$1 AND accepted_at='' AND revoked_at='' AND expires_at > $2
        ORDER BY created_at DESC LIMIT 100`, [tenantId, now().toISOString()]);
      return rows.map(fromRow);
    },

    async findByToken(token) {
      const tokenHash = hashInvitationToken(token);
      if (!enabled()) {
        const found = [...memory.values()].find((item) => item.tokenHash === tokenHash);
        return found ? { ...found } : null;
      }
      const { rows } = await query('SELECT * FROM workspace_invitations WHERE token_hash=$1', [tokenHash]);
      return fromRow(rows[0]) || null;
    },

    async get(tenantId, id) {
      if (!enabled()) {
        const found = memory.get(id);
        return found && found.tenantId === tenantId ? { ...found } : null;
      }
      const { rows } = await query('SELECT * FROM workspace_invitations WHERE tenant_id=$1 AND id=$2', [tenantId, id]);
      return fromRow(rows[0]) || null;
    },

    // Revokes a pending invitation of this workspace. False if it was not pending.
    async revoke(tenantId, id) {
      const at = now().toISOString();
      if (!enabled()) {
        const found = memory.get(id);
        if (!found || found.tenantId !== tenantId || invitationStatus(found, now()) !== 'pending') return false;
        found.revokedAt = at;
        return true;
      }
      const { rowCount } = await query(`UPDATE workspace_invitations SET revoked_at=$3
        WHERE tenant_id=$1 AND id=$2 AND accepted_at='' AND revoked_at='' AND expires_at > $3`, [tenantId, id, at]);
      return rowCount === 1;
    },

    // Marks the invitation used, once. `tx` runs it inside the caller's
    // transaction; null uses memory. False when it was already used, revoked or
    // expired (including a second request racing this one).
    async consume(id, userId, tx = null) {
      const at = now().toISOString();
      if (!tx) {
        if (enabled()) return this.consume(id, userId, query);
        const found = memory.get(id);
        if (!found || invitationStatus(found, now()) !== 'pending') return false;
        found.acceptedAt = at;
        found.acceptedByUserId = userId;
        return true;
      }
      const { rowCount } = await tx(`UPDATE workspace_invitations SET accepted_at=$3, accepted_by_user_id=$2
        WHERE id=$1 AND accepted_at='' AND revoked_at='' AND expires_at > $3`, [id, userId, at]);
      return rowCount === 1;
    },

    // Gives back an invitation whose acceptance could not be completed.
    async restore(id) {
      if (!enabled()) {
        const found = memory.get(id);
        if (found) { found.acceptedAt = ''; found.acceptedByUserId = ''; }
        return;
      }
      await query(`UPDATE workspace_invitations SET accepted_at='', accepted_by_user_id='' WHERE id=$1`, [id]);
    },
  };
}

// ── Email ───────────────────────────────────────────────────────────────────

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// Names are typed by users; keep them to one short line in the subject.
const oneLine = (value, max = 80) => String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function buildInvitationEmail({ workspaceName, inviterName, role, acceptUrl, expiresAt }) {
  const workspace = oneLine(workspaceName) || 'a BD Engine workspace';
  const inviter = oneLine(inviterName) || 'A teammate';
  const roleText = role === 'admin' ? 'an admin' : 'a member';
  const expires = new Date(expiresAt).toLocaleDateString('en-CA', { timeZone: 'America/Toronto', month: 'long', day: 'numeric', year: 'numeric' });
  const subject = `${inviter} invited you to ${workspace} on BD Engine`;
  const text = [
    `${inviter} invited you to join ${workspace} on BD Engine as ${roleText}.`,
    '',
    'You will share the workspace\'s companies, people, open roles and outreach.',
    '',
    `Accept the invitation: ${acceptUrl}`,
    '',
    `The link works once and expires on ${expires}. If you did not expect this, you can ignore it.`,
  ].join('\n');
  const html = `<p>${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(workspace)}</strong> on BD Engine as ${roleText}.</p>
<p>You will share the workspace's companies, people, open roles and outreach.</p>
<p><a href="${escapeHtml(acceptUrl)}">Accept the invitation</a></p>
<p style="color:#526272">The link works once and expires on ${escapeHtml(expires)}. If you did not expect this, you can ignore it.</p>`;
  return { subject, text, html };
}
