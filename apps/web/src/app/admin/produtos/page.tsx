import type { Metadata } from "next";
import { AdminOnly } from "@/components/admin/admin-shell";
import { ProductsScreen } from "./products-screen";

export const metadata: Metadata = { title: "Produtos" };

export default function AdminProductsPage() {
  return (
    <AdminOnly>
      <ProductsScreen />
    </AdminOnly>
  );
}
