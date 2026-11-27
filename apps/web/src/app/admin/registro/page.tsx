import type { Metadata } from "next";
import { AdminOnly } from "@/components/admin/admin-shell";
import { AuditScreen } from "./audit-screen";

export const metadata: Metadata = { title: "Registro" };

export default function AdminAuditPage() {
  return (
    <AdminOnly>
      <AuditScreen />
    </AdminOnly>
  );
}
