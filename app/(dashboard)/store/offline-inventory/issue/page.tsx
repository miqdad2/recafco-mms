import { redirect } from "next/navigation";

export default function IssueRedirectPage() {
  redirect("/store/offline-inventory");
}
