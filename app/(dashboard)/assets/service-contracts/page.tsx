import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { computeContractStatus } from "@/lib/display/service-contract-status";
import {
  ServiceContractsShell,
  type ContractRow,
  type AssetOption,
} from "@/components/assets/service-contracts-shell";

export default async function ServiceContractsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("assets.view");

  const sp                = (await searchParams) ?? {};
  const preselectedAssetId = sp.asset_id ?? null;
  const autoOpen           = sp.open === "new";

  const [contractsRaw, assetsRaw] = await Promise.all([
    prisma.service_contracts.findMany({
      where: { deleted_at: null },
      include: {
        assets: { select: { asset_code: true, asset_name: true } },
      },
      orderBy: { end_date: "asc" },
    }),
    prisma.assets.findMany({
      where: { status: { not: "Disposed" } },
      select: { id: true, asset_code: true, asset_name: true },
      orderBy: { asset_name: "asc" },
    }),
  ]);

  // ── Serialize + compute display status ────────────────────────────────────

  const contracts: ContractRow[] = contractsRaw.map((c) => {
    const meta = computeContractStatus(c.end_date, c.contract_status);
    return {
      id:               c.id,
      asset_id:         c.asset_id,
      asset_code:       c.assets?.asset_code ?? null,
      asset_name:       c.assets?.asset_name ?? null,
      contract_title:   c.contract_title,
      service_company:  c.service_company,
      contract_number:  c.contract_number,
      start_date:       c.start_date.toISOString(),
      end_date:         c.end_date.toISOString(),
      renewal_date:     c.renewal_date?.toISOString() ?? null,
      service_frequency: c.service_frequency,
      status_label:     meta.label,
      status_tone:      meta.tone,
      days_until_expiry: meta.days,
    };
  });

  const assets: AssetOption[] = assetsRaw.map((a) => ({
    id:         a.id,
    asset_code: a.asset_code,
    asset_name: a.asset_name,
  }));

  const activeCount       = contracts.filter((c) => c.status_label === "Active").length;
  const expiringSoonCount = contracts.filter((c) => c.status_label === "Expiring Soon").length;
  const expiredCount      = contracts.filter((c) => c.status_label === "Expired").length;

  return (
    <ServiceContractsShell
      contracts={contracts}
      assets={assets}
      activeCount={activeCount}
      expiringSoonCount={expiringSoonCount}
      expiredCount={expiredCount}
      autoOpen={autoOpen}
      preselectedAssetId={preselectedAssetId}
    />
  );
}
