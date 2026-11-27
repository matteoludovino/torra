import type { Metadata } from "next";
import { AdminOnly } from "@/components/admin/admin-shell";
import { CustomersScreen } from "./customers-screen";

export const metadata: Metadata = { title: "Clientes" };

export default function AdminCustomersPage() {
  return (
    <AdminOnly>
      <CustomersScreen />
    </AdminOnly>
  );
}
