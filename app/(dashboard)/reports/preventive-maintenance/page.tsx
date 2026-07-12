import { redirect } from "next/navigation";

export default async function PreventiveMaintenanceReportsPage() {
  redirect("/reports");
}
