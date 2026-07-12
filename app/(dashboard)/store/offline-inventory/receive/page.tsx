import { redirect } from "next/navigation";

export default function ReceiveRedirectPage() {
  redirect("/store/offline-inventory");
}
