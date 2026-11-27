import type { Metadata } from "next";
import { AdminOnly } from "@/components/admin/admin-shell";
import { CouponsScreen } from "./coupons-screen";

export const metadata: Metadata = { title: "Cupons" };

export default function AdminCouponsPage() {
  return (
    <AdminOnly>
      <CouponsScreen />
    </AdminOnly>
  );
}
