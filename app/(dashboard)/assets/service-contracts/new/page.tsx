import { redirect } from "next/navigation";

export default function NewServiceContractRedirectPage() {
  redirect("/assets/service-contracts?open=new");
}
