import { redirect } from "next/navigation";

import { ArchitecturePresentationMode } from "@/components/architecture/architecture-presentation-mode";
import { EnterpriseArchitecturePage } from "@/components/architecture/enterprise-architecture-page";
import { writeAuditLog } from "@/lib/audit/log";
import { requireUser } from "@/lib/auth/context";

type ArchitecturePageProps = {
  searchParams: Promise<{ presentation?: string }>;
};

export default async function ArchitecturePage({ searchParams }: ArchitecturePageProps) {
  const context = await requireUser();
  const canView = context.role?.slug === "super_admin" || context.permissions.includes("architecture.view");

  if (!canView) {
    redirect("/dashboard?error=permission-denied");
  }

  try {
    await writeAuditLog({
      actorId: context.userId,
      action: "architecture.viewed",
      entityType: "architecture",
      summary: `${context.profile.full_name} viewed the technical architecture page`,
      metadata: { role: context.role?.slug ?? "none" }
    });
  } catch {
    // Architecture page must remain available even if audit logging is temporarily unavailable.
  }

  const params = await searchParams;
  if (params.presentation === "1") {
    return <ArchitecturePresentationMode />;
  }

  return <EnterpriseArchitecturePage />;
}
