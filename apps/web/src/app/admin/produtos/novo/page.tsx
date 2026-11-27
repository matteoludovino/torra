import type { Metadata } from "next";
import { AdminOnly } from "@/components/admin/admin-shell";
import { NewProductScreen } from "./new-product-screen";

export const metadata: Metadata = { title: "Novo produto" };

export default function NewProductPage() {
  return (
    <AdminOnly>
      <NewProductScreen />
    </AdminOnly>
  );
}
