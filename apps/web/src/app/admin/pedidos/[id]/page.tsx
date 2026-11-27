import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminOnly, Loading } from "@/components/admin/admin-shell";
import { AdminOrderScreen } from "./order-screen";

export const metadata: Metadata = { title: "Pedido" };

export default function AdminOrderPage({ params }: PageProps<"/admin/pedidos/[id]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Order params={params} />
    </Suspense>
  );
}

async function Order({ params }: { params: PageProps<"/admin/pedidos/[id]">["params"] }) {
  const { id } = await params;
  return (
    <AdminOnly>
      <AdminOrderScreen id={id} />
    </AdminOnly>
  );
}
