import "server-only";

import { computeMovementDayInfo } from "@/lib/assets/movement-status";
import { prisma } from "@/lib/db/prisma";

// Site Location Asset Report — which assets are (or were) at each site.
// Shared by the screen report (/reports/site-location-assets) and its
// print view, so both always show exactly the same rows for the same
// filters. Read-only; no cost field is selected anywhere in this module.

export const MOVEMENT_STATUS_OPTIONS = [
  { value: "current", label: "Currently at site" },
  { value: "returned", label: "Returned" },
  { value: "all", label: "All movements" },
] as const;

export type MovementStatusFilter = (typeof MOVEMENT_STATUS_OPTIONS)[number]["value"];

export type SiteLocationReportFilters = {
  // "all", a Site Location id, or "text:<name>" for a location that only
  // exists as text typed on older movements.
  locationId: string;
  assetType: string;
  assetStatus: string;
  movementStatus: MovementStatusFilter;
};

export type SiteLocationOption = { value: string; label: string };

export type SiteLocationReportRow = {
  movementId: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  assetType: string;
  assetStatus: string;
  plateNumber: string | null;
  chassisNumber: string | null;
  locationKey: string;
  // The site name saved on the movement itself (its snapshot).
  location: string;
  responsiblePerson: string | null;
  sentDate: string;
  expectedReturnDate: string | null;
  actualReturnDate: string | null;
  daysAtSite: number;
  isActive: boolean;
  isOverdue: boolean;
  overdueDays: number;
  // Active, not overdue, expected back within DUE_SOON_DAYS.
  isDueSoon: boolean;
  // "At Site", "Overdue 3 days", "Due in 2 days", "Returned", "Cancelled".
  statusLabel: string;
  statusTone: "blue" | "red" | "amber" | "green" | "gray";
  purpose: string | null;
  remarks: string | null;
};

export type SiteLocationReport = {
  filters: SiteLocationReportFilters;
  locationOptions: SiteLocationOption[];
  assetTypes: string[];
  assetStatuses: string[];
  selectedLocationLabel: string;
  // False when there is no Site Location and no movement at all.
  hasAnyLocations: boolean;
  rows: SiteLocationReportRow[];
  // One group per location (by name), used when All locations is selected.
  groups: { key: string; label: string; rows: SiteLocationReportRow[] }[];
  // Always the CURRENT picture (active movements) for the selected
  // location / asset type / asset status, whatever Movement status shows.
  summary: { atSite: number; overdue: number; dueThisWeek: number; locationsWithAssets: number };
};

const DUE_SOON_DAYS = 7;

export function parseSiteLocationReportFilters(sp: Record<string, string | undefined>): SiteLocationReportFilters {
  const movementStatus = sp.movementStatus?.trim() ?? "";
  return {
    locationId: sp.locationId?.trim() || "all",
    assetType: sp.assetType?.trim() ?? "",
    assetStatus: sp.assetStatus?.trim() ?? "",
    movementStatus: MOVEMENT_STATUS_OPTIONS.some((o) => o.value === movementStatus)
      ? (movementStatus as MovementStatusFilter)
      : "current",
  };
}

// The same filters as a query string, for the Print / Back links.
export function siteLocationReportQuery(filters: SiteLocationReportFilters): string {
  const p = new URLSearchParams();
  p.set("locationId", filters.locationId);
  if (filters.assetType) p.set("assetType", filters.assetType);
  if (filters.assetStatus) p.set("assetStatus", filters.assetStatus);
  p.set("movementStatus", filters.movementStatus);
  return p.toString();
}

export async function getSiteLocationAssetsReport(filters: SiteLocationReportFilters): Promise<SiteLocationReport> {
  const [locations, movements, assetFacets] = await Promise.all([
    prisma.asset_locations.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, is_active: true } }),
    prisma.asset_movements.findMany({
      where: { assets: { deleted_at: null } },
      orderBy: [{ sent_date: "desc" }, { created_at: "desc" }],
      select: {
        id: true,
        status: true,
        to_location: true,
        asset_location_id: true,
        sent_date: true,
        expected_return_date: true,
        actual_return_date: true,
        responsible_person: true,
        purpose: true,
        remarks: true,
        assets: {
          select: { id: true, asset_code: true, asset_name: true, category: true, plate_number: true, chassis_number: true, status: true },
        },
      },
    }),
    prisma.assets.findMany({ where: { deleted_at: null }, distinct: ["category", "status"], select: { category: true, status: true } }),
  ]);

  const locationById = new Map(locations.map((l) => [l.id, l]));
  const locationByNameLower = new Map(locations.map((l) => [l.name.toLowerCase(), l]));

  // A movement belongs to its linked Site Location; an older movement with
  // only typed text belongs to the Site Location of the same name when one
  // exists, otherwise to a text-only location named exactly as typed.
  function locationOf(m: { asset_location_id: string | null; to_location: string }): { key: string; label: string } {
    const linked = m.asset_location_id ? locationById.get(m.asset_location_id) : undefined;
    if (linked) return { key: linked.id, label: linked.name };
    const typed = m.to_location.trim();
    const sameName = locationByNameLower.get(typed.toLowerCase());
    if (sameName) return { key: sameName.id, label: sameName.name };
    return { key: `text:${typed.toLowerCase()}`, label: typed };
  }

  const now = new Date();
  const allRows: SiteLocationReportRow[] = movements.map((m) => {
    const info = computeMovementDayInfo(m, now);
    const isActive = m.status === "ACTIVE";
    const dueSoon = isActive && info.daysUntilExpectedReturn !== null && info.daysUntilExpectedReturn <= DUE_SOON_DAYS;
    const statusLabel = !isActive
      ? m.status === "RETURNED"
        ? "Returned"
        : "Cancelled"
      : info.isOverdue
        ? `Overdue ${info.overdueDays} day${info.overdueDays === 1 ? "" : "s"}`
        : dueSoon
          ? info.daysUntilExpectedReturn === 0
            ? "Due today"
            : `Due in ${info.daysUntilExpectedReturn} day${info.daysUntilExpectedReturn === 1 ? "" : "s"}`
          : "At Site";
    return {
      movementId: m.id,
      assetId: m.assets.id,
      assetCode: m.assets.asset_code,
      assetName: m.assets.asset_name,
      assetType: m.assets.category,
      assetStatus: m.assets.status,
      plateNumber: m.assets.plate_number,
      chassisNumber: m.assets.chassis_number,
      locationKey: locationOf(m).key,
      location: m.to_location,
      responsiblePerson: m.responsible_person,
      sentDate: m.sent_date.toISOString(),
      expectedReturnDate: m.expected_return_date?.toISOString() ?? null,
      actualReturnDate: m.actual_return_date?.toISOString() ?? null,
      daysAtSite: info.daysOutside,
      isActive,
      isOverdue: isActive && info.isOverdue,
      overdueDays: info.overdueDays,
      isDueSoon: dueSoon,
      statusLabel,
      statusTone: !isActive ? (m.status === "RETURNED" ? "green" : "gray") : info.isOverdue ? "red" : dueSoon ? "amber" : "blue",
      purpose: m.purpose,
      remarks: m.remarks,
    };
  });

  // Location filter options: every Site Location, then any text-only
  // location still found on older movements.
  const groupLabels = new Map<string, string>();
  for (const m of movements) {
    const loc = locationOf(m);
    if (!groupLabels.has(loc.key)) groupLabels.set(loc.key, loc.label);
  }
  const locationOptions: SiteLocationOption[] = [
    ...locations.map((l) => ({ value: l.id, label: l.is_active ? l.name : `${l.name} (inactive)` })),
    ...Array.from(groupLabels.entries())
      .filter(([key]) => key.startsWith("text:"))
      .map(([key, label]) => ({ value: key, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];

  const locationId = filters.locationId === "all" || locationOptions.some((o) => o.value === filters.locationId) ? filters.locationId : "all";
  const applied: SiteLocationReportFilters = { ...filters, locationId };

  const scoped = allRows.filter(
    (r) =>
      (locationId === "all" || r.locationKey === locationId) &&
      (!applied.assetType || r.assetType === applied.assetType) &&
      (!applied.assetStatus || r.assetStatus === applied.assetStatus)
  );

  const active = scoped.filter((r) => r.isActive);
  const summary = {
    atSite: active.length,
    overdue: active.filter((r) => r.isOverdue).length,
    dueThisWeek: active.filter((r) => r.isDueSoon).length,
    locationsWithAssets: new Set(active.map((r) => r.locationKey)).size,
  };

  const rows = scoped.filter((r) =>
    applied.movementStatus === "current" ? r.isActive : applied.movementStatus === "returned" ? r.statusLabel === "Returned" : true
  );

  // Location name, then asset code; movements of one asset newest first.
  const labelOf = (key: string) => groupLabels.get(key) ?? "";
  rows.sort(
    (a, b) =>
      labelOf(a.locationKey).localeCompare(labelOf(b.locationKey)) ||
      a.assetCode.localeCompare(b.assetCode) ||
      b.sentDate.localeCompare(a.sentDate)
  );

  const groups: SiteLocationReport["groups"] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.key === row.locationKey) last.rows.push(row);
    else groups.push({ key: row.locationKey, label: labelOf(row.locationKey), rows: [row] });
  }

  return {
    filters: applied,
    locationOptions,
    assetTypes: [...new Set(assetFacets.map((a) => a.category))].sort((a, b) => a.localeCompare(b)),
    assetStatuses: [...new Set(assetFacets.map((a) => a.status))].sort((a, b) => a.localeCompare(b)),
    selectedLocationLabel:
      locationId === "all" ? "All locations" : locationOptions.find((o) => o.value === locationId)?.label ?? "All locations",
    hasAnyLocations: locations.length > 0 || movements.length > 0,
    rows,
    groups,
    summary,
  };
}
