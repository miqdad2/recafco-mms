import "server-only";

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

type QueryResult<T = unknown> = {
  data: T | null;
  error: Error | null;
  count: number | null;
};

type Filter =
  | { type: "eq"; column: string; value: unknown }
  | { type: "gte"; column: string; value: unknown }
  | { type: "lte"; column: string; value: unknown }
  | { type: "lt"; column: string; value: unknown }
  | { type: "in"; column: string; value: unknown[] }
  | { type: "is"; column: string; value: unknown }
  | { type: "notIn"; column: string; value: unknown[] }
  | { type: "or"; filters: Array<{ column: string; operator: "eq" | "ilike"; value: string }> };

const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// PostgreSQL rejects text parameters for typed columns via $queryRawUnsafe because
// Prisma sends all JS strings as the `text` wire type. We detect column type from the
// column name and add an explicit cast so PostgreSQL can accept the parameter.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Exact-name sets for columns whose type cannot be inferred from the suffix alone.
const UUID_COLUMNS = new Set([
  "id", "created_by", "updated_by", "deleted_by",
  "requested_by_department_id", "department_id", "asset_id",
  "assigned_supervisor_id", "profile_id", "role_id", "user_id",
  "work_order_id", "parts_request_id", "purchase_request_id",
  "technician_id", "target_profile_id", "actor_profile_id",
  "entity_id", "permission_id", "part_id",
  "approved_by", "decided_by", "assigned_by", "uploaded_by",
  "changed_by", "finance_approved_by", "ceo_approved_by",
  "cost_reviewed_by", "prepared_by", "requested_by",
]);

const DATE_COLUMNS = new Set([
  "date_of_order", "order_date", "due_date", "completed_date",
  "closed_date", "service_due_date", "next_service_date",
  "purchase_date", "warranty_expiry_date", "registration_expiry_date",
  "insurance_expiry_date",
]);

const NUMERIC_COLUMNS = new Set([
  "amount", "rate", "unit_price", "quantity",
  "running_hours", "running_kms", "kilometers",
  "cost", "estimated_cost", "total_cost", "total_labor_cost",
  "total_material_cost", "minimum_stock", "current_stock",
  "hours", "next_service_kilometer", "next_service_running_hours",
  "current_kilometer_reading", "current_running_hours",
  "ceo_approval_threshold",
]);

// Returns the SQL placeholder expression for a given column + value + positional index.
// Non-string values (null, number, boolean) are already wire-typed correctly by Prisma.
// String values sent to typed columns need an explicit cast; NULLIF handles empty strings
// so that '' becomes NULL instead of triggering an invalid-cast error.
function pgParam(column: string, value: unknown, n: number): string {
  if (typeof value !== "string") return `$${n}`;

  // UUID: exact column name match, or fall back to value-shape detection
  if (UUID_COLUMNS.has(column) || UUID_RE.test(value)) {
    return `NULLIF($${n}, '')::uuid`;
  }

  // Date (PostgreSQL date — no time): exact name match or *_date suffix (but not *_datetime)
  if (DATE_COLUMNS.has(column) || (column.endsWith("_date") && !column.endsWith("_datetime"))) {
    return `NULLIF($${n}, '')::date`;
  }

  // Timestamptz: *_at suffix, *_datetime suffix, or locked_until
  if (column.endsWith("_at") || column.endsWith("_datetime") || column === "locked_until") {
    return `NULLIF($${n}, '')::timestamptz`;
  }

  // Numeric
  if (NUMERIC_COLUMNS.has(column)) {
    return `NULLIF($${n}, '')::numeric`;
  }

  return `$${n}`;
}

type PrismaExecutor = typeof prisma | Prisma.TransactionClient;

async function getCurrentAuditActorId() {
  try {
    const { getCurrentUserContext } = await import("@/lib/auth/context");
    return (await getCurrentUserContext())?.userId ?? null;
  } catch {
    return null;
  }
}

async function runAuditedMutation<T>(callback: (client: PrismaExecutor) => Promise<T>) {
  const actorId = await getCurrentAuditActorId();

  if (!actorId) {
    return callback(prisma);
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.current_profile_id', ${actorId}, true)`;
    return callback(tx);
  });
}

function assertIdentifier(value: string) {
  if (!identifierPattern.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return value;
}

function splitTopLevelColumns(columns: string) {
  const parts: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of columns) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);

    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function normalizeSelect(columns: string) {
  if (!columns || columns.trim() === "*") return "*";
  if (columns.includes("(") || columns.includes(")")) return "*";
  const topLevel = splitTopLevelColumns(columns)
    .map((column) => column.trim())
    .filter((column) => column && !column.includes("(") && !column.includes(")") && !column.includes("!") && column !== "*")
    .map((column) => assertIdentifier(column));
  return topLevel.length ? topLevel.map((column) => `"${column}"`).join(", ") : "*";
}

function parseRequestedRelations(columns: string) {
  return new Set(
    splitTopLevelColumns(columns)
      .map((column) => column.trim())
      .filter((column) => column.includes("("))
      .map((column) => column.split("(")[0].split("!")[0].trim())
      .filter(Boolean)
  );
}

function parseNotIn(value: string) {
  return value
    .replace(/^\(/, "")
    .replace(/\)$/, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

function serializeDbValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (Array.isArray(value)) {
    return value.map(serializeDbValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeDbValue(item)]));
  }

  return value;
}

function serializeDbRows(rows: unknown[]) {
  return rows.map((row) => serializeDbValue(row));
}

function uniqueValues(rows: Array<Record<string, any>>, column: string) {
  return [...new Set(rows.map((row) => row[column]).filter(Boolean).map(String))];
}

function byId<T extends Record<string, any>>(rows: T[]) {
  return new Map(rows.map((row) => [String(row.id), row]));
}

function applyOneToOne(rows: Array<Record<string, any>>, relationName: string, foreignKey: string, relatedRows: Array<Record<string, any>>) {
  const lookup = byId(relatedRows);
  rows.forEach((row) => {
    row[relationName] = row[foreignKey] ? lookup.get(String(row[foreignKey])) ?? null : null;
  });
}

async function fetchRowsByIds(table: string, ids: string[]) {
  if (!ids.length) return [];
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
  return serializeDbRows(await prisma.$queryRawUnsafe<Record<string, any>[]>(`select * from "${assertIdentifier(table)}" where id in (${placeholders})`, ...ids)) as Array<Record<string, any>>;
}

async function hydrateWorkOrderAssignments(rows: Array<Record<string, any>>) {
  const workOrderIds = uniqueValues(rows, "id");
  if (!workOrderIds.length) return;
  const placeholders = workOrderIds.map((_, index) => `$${index + 1}`).join(", ");
  const assignments = serializeDbRows(
    await prisma.$queryRawUnsafe<Record<string, any>[]>(
      `select * from "work_order_assignments" where work_order_id in (${placeholders}) order by assigned_at asc`,
      ...workOrderIds
    )
  ) as Array<Record<string, any>>;
  const profiles = byId(await fetchRowsByIds("profiles", uniqueValues(assignments, "technician_id")));
  assignments.forEach((assignment) => {
    assignment.profiles = assignment.technician_id ? profiles.get(String(assignment.technician_id)) ?? null : null;
  });
  const grouped = new Map<string, Array<Record<string, any>>>();
  assignments.forEach((assignment) => {
    const list = grouped.get(String(assignment.work_order_id)) ?? [];
    list.push(assignment);
    grouped.set(String(assignment.work_order_id), list);
  });
  rows.forEach((row) => {
    row.work_order_assignments = grouped.get(String(row.id)) ?? [];
  });
}

async function hydrateRows(table: string, rows: unknown[], requestedRelations: Set<string>) {
  if (!rows.length || !requestedRelations.size) return rows;
  const records = rows.filter((row): row is Record<string, any> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  if (!records.length) return rows;

  if (requestedRelations.has("departments")) {
    const foreignKey = table === "work_orders" ? "requested_by_department_id" : "department_id";
    applyOneToOne(records, "departments", foreignKey, await fetchRowsByIds("departments", uniqueValues(records, foreignKey)));
  }

  if (requestedRelations.has("assets")) {
    applyOneToOne(records, "assets", "asset_id", await fetchRowsByIds("assets", uniqueValues(records, "asset_id")));
  }

  if (requestedRelations.has("work_orders")) {
    applyOneToOne(records, "work_orders", "work_order_id", await fetchRowsByIds("work_orders", uniqueValues(records, "work_order_id")));
  }

  if (requestedRelations.has("parts")) {
    applyOneToOne(records, "parts", "part_id", await fetchRowsByIds("parts", uniqueValues(records, "part_id")));
  }

  if (requestedRelations.has("roles")) {
    applyOneToOne(records, "roles", "role_id", await fetchRowsByIds("roles", uniqueValues(records, "role_id")));
  }

  if (requestedRelations.has("profiles")) {
    const foreignKey = table === "work_order_assignments" ? "technician_id" : table === "work_order_labor" ? "technician_id" : "requested_by";
    applyOneToOne(records, "profiles", foreignKey, await fetchRowsByIds("profiles", uniqueValues(records, foreignKey)));
  }

  if (requestedRelations.has("permissions") && table === "role_permissions") {
    applyOneToOne(records, "permissions", "permission_id", await fetchRowsByIds("permissions", uniqueValues(records, "permission_id")));
  }

  if (requestedRelations.has("role_permissions") && table === "roles") {
    const roleIds = uniqueValues(records, "id");
    if (roleIds.length) {
      const placeholders = roleIds.map((_, index) => `$${index + 1}`).join(", ");
      const rolePermissions = serializeDbRows(
        await prisma.$queryRawUnsafe<Record<string, any>[]>(
          `select * from "role_permissions" where role_id in (${placeholders})`,
          ...roleIds
        )
      ) as Array<Record<string, any>>;
      const permissions = byId(await fetchRowsByIds("permissions", uniqueValues(rolePermissions, "permission_id")));
      rolePermissions.forEach((rolePermission) => {
        rolePermission.permissions = rolePermission.permission_id ? permissions.get(String(rolePermission.permission_id)) ?? null : null;
      });
      const grouped = new Map<string, Array<Record<string, any>>>();
      rolePermissions.forEach((rolePermission) => {
        const list = grouped.get(String(rolePermission.role_id)) ?? [];
        list.push(rolePermission);
        grouped.set(String(rolePermission.role_id), list);
      });
      records.forEach((row) => {
        row.role_permissions = grouped.get(String(row.id)) ?? [];
      });
    }
  }

  if (requestedRelations.has("work_order_assignments") && table === "work_orders") {
    await hydrateWorkOrderAssignments(records);
  }

  return rows;
}

class LocalQueryBuilder<T = any[]> implements PromiseLike<QueryResult<T>> {
  private operation: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private selectColumns = "*";
  private rawSelectColumns = "*";
  private filters: Filter[] = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private onConflictColumns: string[] | null = null;
  private singleMode: "single" | "maybeSingle" | null = null;
  private countMode = false;
  private headMode = false;

  constructor(private readonly table: string) {
    assertIdentifier(table);
  }

  select(columns = "*", options?: { count?: "exact"; head?: boolean }): LocalQueryBuilder<any[]> {
    this.operation = this.operation === "select" ? "select" : this.operation;
    this.rawSelectColumns = columns;
    this.selectColumns = normalizeSelect(columns);
    this.countMode = options?.count === "exact";
    this.headMode = Boolean(options?.head);
    return this as unknown as LocalQueryBuilder<any[]>;
  }

  insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
    this.operation = "insert";
    this.payload = Array.isArray(payload) ? payload.map(normalizeRow) : normalizeRow(payload);
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.operation = "update";
    this.payload = normalizeRow(payload);
    return this;
  }

  upsert(payload: Record<string, unknown> | Record<string, unknown>[], options?: { onConflict?: string }) {
    this.operation = "upsert";
    this.payload = Array.isArray(payload) ? payload.map(normalizeRow) : normalizeRow(payload);
    this.onConflictColumns = options?.onConflict?.split(",").map((column) => assertIdentifier(column.trim())).filter(Boolean) ?? null;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    if (column.includes(".")) return this;
    this.filters.push({ type: "eq", column: assertIdentifier(column), value });
    return this;
  }

  in(column: string, value: unknown[]) {
    if (column.includes(".")) return this;
    this.filters.push({ type: "in", column: assertIdentifier(column), value });
    return this;
  }

  gte(column: string, value: unknown) {
    if (column.includes(".")) return this;
    this.filters.push({ type: "gte", column: assertIdentifier(column), value });
    return this;
  }

  lte(column: string, value: unknown) {
    if (column.includes(".")) return this;
    this.filters.push({ type: "lte", column: assertIdentifier(column), value });
    return this;
  }

  lt(column: string, value: unknown) {
    if (column.includes(".")) return this;
    this.filters.push({ type: "lt", column: assertIdentifier(column), value });
    return this;
  }

  is(column: string, value: unknown) {
    if (column.includes(".")) return this;
    this.filters.push({ type: "is", column: assertIdentifier(column), value });
    return this;
  }

  not(column: string, operator: string, value: string) {
    if (column.includes(".")) return this;
    if (operator === "in") {
      this.filters.push({ type: "notIn", column: assertIdentifier(column), value: parseNotIn(value) });
    }
    return this;
  }

  or(expression: string) {
    const filters = expression
      .split(",")
      .map((part) => part.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.(eq|ilike)\.(.+)$/))
      .filter(Boolean)
      .map((match) => ({ column: assertIdentifier(match![1]), operator: match![2] as "eq" | "ilike", value: match![3] }));
    if (filters.length) this.filters.push({ type: "or", filters });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column: assertIdentifier(column), ascending: options?.ascending !== false });
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  range(from: number, to: number) {
    this.offsetValue = from;
    this.limitValue = Math.max(0, to - from + 1);
    return this;
  }

  single(): LocalQueryBuilder<T extends Array<infer Row> ? Row : T> {
    this.singleMode = "single";
    this.limitValue = 1;
    return this as unknown as LocalQueryBuilder<T extends Array<infer Row> ? Row : T>;
  }

  maybeSingle(): LocalQueryBuilder<T extends Array<infer Row> ? Row : T> {
    this.singleMode = "maybeSingle";
    this.limitValue = 1;
    return this as unknown as LocalQueryBuilder<T extends Array<infer Row> ? Row : T>;
  }

  returns<TResult>() {
    return this as unknown as LocalQueryBuilder<TResult>;
  }

  then<TResult1 = QueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private whereSql(values: unknown[]) {
    if (!this.filters.length) return "";
    const clauses = this.filters.map((filter) => {
      if (filter.type === "eq" || filter.type === "gte" || filter.type === "lte" || filter.type === "lt") {
        values.push(filter.value);
        const operator = filter.type === "gte" ? ">=" : filter.type === "lte" ? "<=" : filter.type === "lt" ? "<" : "=";
        return `"${filter.column}" ${operator} $${values.length}`;
      }
      if (filter.type === "in") {
        if (!filter.value.length) return "false";
        const placeholders = filter.value.map((item) => {
          values.push(item);
          return `$${values.length}`;
        });
        return `"${filter.column}" in (${placeholders.join(", ")})`;
      }
      if (filter.type === "notIn") {
        if (!filter.value.length) return "true";
        const placeholders = filter.value.map((item) => {
          values.push(item);
          return `$${values.length}`;
        });
        return `"${filter.column}" not in (${placeholders.join(", ")})`;
      }
      if (filter.type === "is") {
        if (filter.value === null) return `"${filter.column}" is null`;
        values.push(filter.value);
        return `"${filter.column}" is not distinct from $${values.length}`;
      }
      const orClauses = filter.filters.map((item) => {
        values.push(item.operator === "ilike" ? item.value.replace(/\*/g, "%") : item.value);
        return item.operator === "ilike" ? `"${item.column}" ilike $${values.length}` : `"${item.column}" = $${values.length}`;
      });
      return `(${orClauses.join(" or ")})`;
    });
    return ` where ${clauses.join(" and ")}`;
  }

  private suffixSql(values: unknown[]) {
    const order = this.orders.length
      ? ` order by ${this.orders.map((item) => `"${item.column}" ${item.ascending ? "asc" : "desc"}`).join(", ")}`
      : "";
    const limit = this.limitValue !== null ? (values.push(this.limitValue), ` limit $${values.length}`) : "";
    const offset = this.offsetValue !== null ? (values.push(this.offsetValue), ` offset $${values.length}`) : "";
    return `${order}${limit}${offset}`;
  }

  private async execute(): Promise<QueryResult<T>> {
    try {
      if (this.operation === "select") return await this.executeSelect();
      if (this.operation === "insert") return await this.executeInsert();
      if (this.operation === "update") return await this.executeUpdate();
      if (this.operation === "upsert") return await this.executeUpsert();
      return await this.executeDelete();
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error(`[local-query-client] ${this.operation} on "${this.table}" failed:`, error);
      }
      return { data: null, error: error instanceof Error ? error : new Error(String(error)), count: null };
    }
  }

  private async executeSelect(): Promise<QueryResult<T>> {
    const values: unknown[] = [];
    const where = this.whereSql(values);
    const whereValues = [...values];
    const suffix = this.suffixSql(values);
    const table = `"${this.table}"`;

    if (this.countMode && this.headMode) {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`select count(*)::bigint as count from ${table}${where}`, ...whereValues);
      return { data: null, error: null, count: Number(rows[0]?.count ?? 0) };
    }

    const count = this.countMode
      ? Number((await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`select count(*)::bigint as count from ${table}${where}`, ...whereValues))[0]?.count ?? 0)
      : null;
    const rows = await hydrateRows(
      this.table,
      serializeDbRows(await prisma.$queryRawUnsafe<unknown[]>(`select ${this.selectColumns} from ${table}${where}${suffix}`, ...values)),
      parseRequestedRelations(this.rawSelectColumns)
    );
    const data = this.singleMode ? ((rows[0] ?? null) as T | null) : (rows as T);
    return { data, error: null, count };
  }

  private async executeInsert(): Promise<QueryResult<T>> {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
    if (!rows.length) return { data: [] as T, error: null, count: null };
    const inserted: unknown[] = [];

    await runAuditedMutation(async (client) => {
      for (const row of rows) {
        const entries = Object.entries(row);
        const columns = entries.map(([column]) => `"${assertIdentifier(column)}"`).join(", ");
        const values = entries.map(([, value]) => value);
        const placeholders = entries.map(([column, value], index) => pgParam(column, value, index + 1)).join(", ");
        const result = await client.$queryRawUnsafe<unknown[]>(
          `insert into "${this.table}" (${columns}) values (${placeholders}) returning ${this.selectColumns}`,
          ...values
        );
        inserted.push(...serializeDbRows(result));
      }
    });

    const data = this.singleMode ? ((inserted[0] ?? null) as T | null) : (inserted as T);
    return { data, error: null, count: null };
  }

  private async executeUpdate(): Promise<QueryResult<T>> {
    const payload = (this.payload ?? {}) as Record<string, unknown>;
    const entries = Object.entries(payload);
    const values = entries.map(([, value]) => value);
    const setSql = entries.map(([column, value], index) => `"${assertIdentifier(column)}" = ${pgParam(column, value, index + 1)}`).join(", ");
    const where = this.whereSql(values);
    const rows = serializeDbRows(await runAuditedMutation((client) => client.$queryRawUnsafe<unknown[]>(`update "${this.table}" set ${setSql}${where} returning ${this.selectColumns}`, ...values)));
    const data = this.singleMode ? ((rows[0] ?? null) as T | null) : (rows as T);
    return { data, error: null, count: null };
  }

  private async executeUpsert(): Promise<QueryResult<T>> {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
    const upserted: unknown[] = [];

    await runAuditedMutation(async (client) => {
      for (const row of rows) {
        const entries = Object.entries(row);
        const columns = entries.map(([column]) => `"${assertIdentifier(column)}"`).join(", ");
        const values = entries.map(([, value]) => value);
        const placeholders = entries.map(([column, value], index) => pgParam(column, value, index + 1)).join(", ");
        const updateSql = entries
          .filter(([column]) => column !== "id")
          .map(([column]) => `"${assertIdentifier(column)}" = excluded."${assertIdentifier(column)}"`)
          .join(", ");
        const conflictColumns = this.onConflictColumns?.length
          ? this.onConflictColumns
          : [Object.prototype.hasOwnProperty.call(row, "id") ? "id" : entries[0]?.[0]];
        const result = await client.$queryRawUnsafe<unknown[]>(
          `insert into "${this.table}" (${columns}) values (${placeholders}) on conflict (${conflictColumns.map((column) => `"${assertIdentifier(column)}"`).join(", ")}) do update set ${updateSql} returning ${this.selectColumns}`,
          ...values
        );
        upserted.push(...serializeDbRows(result));
      }
    });

    const data = this.singleMode ? ((upserted[0] ?? null) as T | null) : (upserted as T);
    return { data, error: null, count: null };
  }

  private async executeDelete(): Promise<QueryResult<T>> {
    const values: unknown[] = [];
    const where = this.whereSql(values);
    const rows = serializeDbRows(await runAuditedMutation((client) => client.$queryRawUnsafe<unknown[]>(`delete from "${this.table}"${where} returning ${this.selectColumns}`, ...values)));
    const data = this.singleMode ? ((rows[0] ?? null) as T | null) : (rows as T);
    return { data, error: null, count: null };
  }
}

export function createLocalQueryClient() {
  return {
    from<T = any[]>(table: string) {
      return new LocalQueryBuilder<T>(table);
    },
    auth: {
      admin: {
        async listUsers(_params?: { page?: number; perPage?: number }) {
          void _params;
          const rows = await prisma.$queryRaw<Array<{ id: string; email: string | null; created_at: Date }>>`
            select profile_id as id, email, created_at
            from public.auth_users
            order by created_at desc
          `;
          return {
            data: {
              users: rows.map((row) => ({
                id: row.id,
                email: row.email,
                created_at: row.created_at.toISOString()
              }))
            },
            error: null
          };
        }
      }
    }
  };
}
