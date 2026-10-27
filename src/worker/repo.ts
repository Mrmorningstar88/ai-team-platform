// All tenant data access lives here. Every query on a tenant table binds
// org_id, so one organization can never read or change another's rows.

export interface AgentRow { id: string; role: string; name: string; autonomy: string; status: string }
export interface ApprovalRow { id: string; task_id: string; summary: string; decision: string | null }
export interface MessageRow { id: string; author: "owner" | "ceo"; body: string; created_at: string }

export async function isMember(db: D1Database, orgId: string, userId: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS ok FROM memberships WHERE org_id = ? AND user_id = ?").bind(orgId, userId).first();
  return row !== null;
}

export async function listAgents(db: D1Database, orgId: string): Promise<AgentRow[]> {
  const { results } = await db
    .prepare("SELECT id, role, name, autonomy, status FROM agents WHERE org_id = ? ORDER BY created_at, id")
    .bind(orgId)
    .all<AgentRow>();
  return results;
}

export async function listPendingApprovals(db: D1Database, orgId: string): Promise<ApprovalRow[]> {
  const { results } = await db
    .prepare("SELECT id, task_id, summary, decision FROM approvals WHERE org_id = ? AND decision IS NULL ORDER BY id")
    .bind(orgId)
    .all<ApprovalRow>();
  return results;
}

/** Records a decision once. Returns false when the approval is not this org's or was already decided. */
export async function decideApproval(
  db: D1Database,
  orgId: string,
  approvalId: string,
  userId: string,
  decision: "approved" | "rejected",
  nowIso: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      "UPDATE approvals SET decision = ?, decided_by = ?, decided_at = ? WHERE id = ? AND org_id = ? AND decision IS NULL",
    )
    .bind(decision, userId, nowIso, approvalId, orgId)
    .run();
  if (res.meta.changes !== 1) return false;
  await db
    .prepare("INSERT INTO audit_log (id, org_id, actor, action) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), orgId, `user:${userId}`, `approval:${approvalId}:${decision}`)
    .run();
  return true;
}

export async function listMessages(db: D1Database, orgId: string, limit = 50): Promise<MessageRow[]> {
  const { results } = await db
    .prepare("SELECT id, author, body, created_at FROM messages WHERE org_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
    .bind(orgId, limit)
    .all<MessageRow>();
  return results.reverse();
}

export async function addOwnerMessage(db: D1Database, orgId: string, body: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO messages (id, org_id, author, body) VALUES (?, ?, 'owner', ?)").bind(id, orgId, body).run();
  return id;
}

// ---- Accounts: users, organizations and sign-in bookkeeping ----

export interface UserRow { id: string; email: string; name: string; password_hash: string | null }
export interface OrgSummary { id: string; name: string; goal: string; role: string }

/** The team every new organization starts with, in office order. */
const STARTER_TEAM: { role: string; name: string; autonomy: string }[] = [
  { role: "ceo", name: "CEO", autonomy: "L0" },
  { role: "techlead", name: "Техлид", autonomy: "L1" },
  { role: "qa", name: "Тестировщик", autonomy: "L1" },
  { role: "seo", name: "SEO", autonomy: "L1" },
  { role: "content", name: "Контент", autonomy: "L1" },
  { role: "analyst", name: "Аналитик", autonomy: "L0" },
];

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?").bind(email).first<UserRow>();
}

export async function findUserById(db: D1Database, id: string): Promise<Omit<UserRow, "password_hash"> | null> {
  return db.prepare("SELECT id, email, name FROM users WHERE id = ?").bind(id).first();
}

export async function listUserOrgs(db: D1Database, userId: string): Promise<OrgSummary[]> {
  const { results } = await db
    // rowid is insertion order, so projects keep the order they were added in.
    .prepare("SELECT o.id, o.name, o.goal, m.role FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY o.rowid")
    .bind(userId)
    .all<OrgSummary>();
  return results;
}

/** Statements that create an organization owned by `userId`, with its starter team. */
function orgStatements(db: D1Database, orgId: string, userId: string, org: { name: string; goal: string }): D1PreparedStatement[] {
  return [
    db.prepare("INSERT INTO orgs (id, name, goal) VALUES (?, ?, ?)").bind(orgId, org.name, org.goal),
    db.prepare("INSERT INTO memberships (org_id, user_id, role) VALUES (?, ?, 'owner')").bind(orgId, userId),
    // One second apart, so listAgents (ORDER BY created_at) keeps office order.
    ...STARTER_TEAM.map((a, i) =>
      db
        .prepare("INSERT INTO agents (id, org_id, role, name, autonomy, created_at) VALUES (?, ?, ?, ?, ?, datetime('now', ?))")
        .bind(crypto.randomUUID(), orgId, a.role, a.name, a.autonomy, `+${i} seconds`),
    ),
    db.prepare("INSERT INTO audit_log (id, org_id, actor, action) VALUES (?, ?, ?, 'org:created')").bind(crypto.randomUUID(), orgId, `user:${userId}`),
  ];
}

/**
 * Creates the owner, their organization and its starter team in one atomic
 * batch. Returns null when the email is already registered.
 */
export async function createAccount(
  db: D1Database,
  input: { email: string; name: string; passwordHash: string; orgName: string; promo: string },
): Promise<{ userId: string; orgId: string } | null> {
  if (await findUserByEmail(db, input.email)) return null;
  const userId = crypto.randomUUID();
  const orgId = crypto.randomUUID();
  try {
    await db.batch([
      db.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)").bind(userId, input.email, input.name, input.passwordHash),
      ...orgStatements(db, orgId, userId, { name: input.orgName, goal: "" }),
      // Which promo code brought this owner in, for later sales reports.
      db.prepare("INSERT INTO audit_log (id, org_id, actor, action) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), orgId, `user:${userId}`, `signup:promo:${input.promo}`),
    ]);
  } catch (e) {
    // Two sign-ups racing for one email: the UNIQUE constraint decides.
    if (String(e).includes("UNIQUE")) return null;
    throw e;
  }
  return { userId, orgId };
}

/** Adds another project (organization) for an existing user, with its starter team. */
export async function createOrg(db: D1Database, userId: string, org: { name: string; goal: string }): Promise<string> {
  const orgId = crypto.randomUUID();
  await db.batch(orgStatements(db, orgId, userId, org));
  return orgId;
}

export async function countRecentLoginFailures(db: D1Database, email: string, sinceMs: number): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE email = ? AND at_ms > ?").bind(email, sinceMs).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function recordLoginFailure(db: D1Database, email: string, nowMs: number): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO login_failures (email, at_ms) VALUES (?, ?)").bind(email, nowMs),
    // Keep the table small: a day of history is plenty for rate limiting.
    db.prepare("DELETE FROM login_failures WHERE at_ms < ?").bind(nowMs - 86_400_000),
  ]);
}

export async function clearLoginFailures(db: D1Database, email: string): Promise<void> {
  await db.prepare("DELETE FROM login_failures WHERE email = ?").bind(email).run();
}

// ---- Password reset links ----

export async function countRecentResets(db: D1Database, userId: string, sinceMs: number): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_ms > ?").bind(userId, sinceMs).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function createReset(db: D1Database, userId: string, tokenHash: string, nowMs: number, ttlMs: number): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_ms, created_ms) VALUES (?, ?, ?, ?)").bind(tokenHash, userId, nowMs + ttlMs, nowMs),
    db.prepare("DELETE FROM password_resets WHERE expires_ms < ?").bind(nowMs - 86_400_000),
  ]);
}

/**
 * Spends a reset link: sets the new password and removes every open link for
 * that user, in one batch. Returns the user id, or null for an unknown,
 * expired or already used link.
 */
export async function useReset(db: D1Database, tokenHash: string, passwordHash: string, nowMs: number): Promise<string | null> {
  const row = await db
    .prepare("SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_ms > ?")
    .bind(tokenHash, nowMs)
    .first<{ user_id: string }>();
  if (!row) return null;
  const results = await db.batch([
    // Deleting this token first means a second, racing request changes nothing.
    db.prepare("DELETE FROM password_resets WHERE token_hash = ?").bind(tokenHash),
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND changes() = 1").bind(passwordHash, row.user_id),
    db.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(row.user_id),
  ]);
  return results[1]?.meta.changes ? row.user_id : null;
}

// ---- Landing page requests ----

export interface Lead { kind: "access" | "enterprise"; name: string; email: string; company: string; message: string }

export async function countRecentLeads(db: D1Database, sinceMs: number): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM leads WHERE created_ms > ?").bind(sinceMs).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function addLead(db: D1Database, lead: Lead, nowMs: number): Promise<void> {
  await db
    .prepare("INSERT INTO leads (id, kind, name, email, company, message, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), lead.kind, lead.name, lead.email, lead.company, lead.message, nowMs)
    .run();
}

/** Reads a server-generated setting, creating it with `make()` on first use. */
export async function getOrCreateSetting(db: D1Database, key: string, make: () => string): Promise<string> {
  const existing = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
  if (existing) return existing.value;
  // INSERT OR IGNORE + re-read so two cold starts agree on one value.
  await db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)").bind(key, make()).run();
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row!.value;
}
