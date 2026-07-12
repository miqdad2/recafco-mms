import { redirect } from "next/navigation";
import { NewPartWizard } from "@/components/store/new-part-wizard";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { canViewCosts } from "@/lib/security/permissions";

export default async function NewPartPage() {
  redirect("/store/offline-inventory");
  const context = await requirePermission("parts.manage");

  return (
    <>
      <PageHeader
        title="New Spare Part"
        description="Add a spare part to the inventory in three quick steps."
      />
      <div className="p-4 lg:p-6">
        <NewPartWizard canViewCosts={canViewCosts(context)} />
      </div>
    </>
  );
}
