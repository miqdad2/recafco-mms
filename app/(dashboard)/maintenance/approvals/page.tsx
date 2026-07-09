import { redirect } from "next/navigation";

// The approval module is not active for the Maintenance Department scope.
// Anyone navigating directly to this route is sent to the Repair Orders list.
export default function ApprovalsPage() {
  redirect("/maintenance/work-orders");
}
