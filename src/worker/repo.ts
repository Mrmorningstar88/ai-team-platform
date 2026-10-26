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
