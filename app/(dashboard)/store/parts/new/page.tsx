import { PartForm } from "@/components/store/part-form";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";

export default async function NewPartPage() {
  await requirePermission("parts.manage");

  return (
    <>
      <PageHeader title="New Spare Part" description="Create a spare part inventory record for store issue and future parts requests." />
      <div className="p-4 lg:p-6">
        <PartForm />
      </div>
    </>
  );
}
