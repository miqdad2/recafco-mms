import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  OfflineInventoryShell,
  type MovementRow,
  type WorkOrderOption,
  type BalanceItem,
} from "@/components/store/offline-inventory-shell";

function buildBalanceKey(m: {
  part_id: string | null;
  manual_material_name: string | null;
  unit: string;
}): string {
  if (m.part_id) return `part:${m.part_id}`;
  return `manual:${(m.manual_material_name ?? "").toLowerCase().trim()}|${m.unit.toLowerCase().trim()}`;
}

export default async function OfflineInventoryPage() {
  await requirePermission("parts.view");

  const [allMovementsRaw, workOrdersRaw] = await Promise.all([
    prisma.offline_inventory_movements.findMany({
      where: { deleted_at: null },
      include: {
        parts:       { select: { part_name: true, part_number: true } },
        work_orders: { select: { work_order_number: true } },
        profiles:    { select: { full_name: true } },
      },
      orderBy: [{ movement_date: "desc" }, { created_at: "desc" }],
    }),
    prisma.work_orders.findMany({
      select: { id: true, work_order_number: true },
      orderBy: { created_at: "desc" },
      take: 100,
    }),
  ]);

  // ── Compute totals and per-material balance ────────────────────────────────

  let totalReceived = 0;
  let totalIssued   = 0;

  const balanceAccum = new Map<string, { item: BalanceItem; lastDate: Date }>();

  for (const m of allMovementsRaw) {
    const qty = Number(m.quantity);
    const key = buildBalanceKey(m);

    if (!balanceAccum.has(key)) {
      balanceAccum.set(key, {
        item: {
          key,
          part_id:              m.part_id,
          display_name:         m.parts?.part_name ?? m.manual_material_name ?? "Unknown",
          part_number:          m.parts?.part_number ?? m.manual_part_number ?? null,
          manual_material_name: m.manual_material_name,
          unit:                 m.unit,
          total_received:       0,
          total_issued:         0,
          balance:              0,
          last_movement_date:   m.movement_date.toISOString(),
        },
        lastDate: m.movement_date,
      });
    }

    const entry = balanceAccum.get(key)!;

    if (m.movement_type === "RECEIVED") {
      totalReceived              += qty;
      entry.item.total_received  += qty;
      entry.item.balance         += qty;
    } else if (m.movement_type === "ISSUED") {
      totalIssued                += qty;
      entry.item.total_issued    += qty;
      entry.item.balance         -= qty;
    }

    if (m.movement_date > entry.lastDate) {
      entry.lastDate                 = m.movement_date;
      entry.item.last_movement_date  = m.movement_date.toISOString();
    }
  }

  const balance      = totalReceived - totalIssued;
  const balanceItems = Array.from(balanceAccum.values())
    .map((e) => e.item)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  // ── Serialize movements for ledger (most-recent 200) ──────────────────────

  const movements: MovementRow[] = allMovementsRaw.slice(0, 200).map((m) => ({
    id:                    m.id,
    movement_type:         m.movement_type,
    movement_date:         m.movement_date.toISOString(),
    part_name:             m.parts?.part_name ?? null,
    part_number_display:   m.parts?.part_number ?? m.manual_part_number ?? null,
    manual_material_name:  m.manual_material_name,
    quantity:              Number(m.quantity),
    unit:                  m.unit,
    counterparty:          m.counterparty,
    reference_number:      m.reference_number,
    related_work_order_id: m.related_work_order_id,
    work_order_number:     m.work_orders?.work_order_number ?? null,
    remarks:               m.remarks,
    created_by_name:       m.profiles.full_name,
  }));

  const workOrders: WorkOrderOption[] = workOrdersRaw.map((wo) => ({
    id:                wo.id,
    work_order_number: wo.work_order_number,
  }));

  return (
    <OfflineInventoryShell
      movements={movements}
      workOrders={workOrders}
      balanceItems={balanceItems}
      totalReceived={totalReceived}
      totalIssued={totalIssued}
      balance={balance}
    />
  );
}
