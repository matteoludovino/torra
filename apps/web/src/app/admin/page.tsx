import type { Metadata } from "next";
import { AdminOnly } from "@/components/admin/admin-shell";
import { DashboardScreen } from "./dashboard-screen";

export const metadata: Metadata = { title: "Painel" };

export default function AdminPage() {
  return (
    <AdminOnly>
      <DashboardScreen />
    </AdminOnly>
  );
}
