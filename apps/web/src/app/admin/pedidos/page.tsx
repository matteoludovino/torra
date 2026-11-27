import { ORDER_STATUSES, type OrderStatus } from "@torra/shared";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminOnly, Loading } from "@/components/admin/admin-shell";
import { OrdersScreen } from "./orders-screen";

export const metadata: Metadata = { title: "Pedidos" };

export default function AdminOrdersPage({ searchParams }: PageProps<"/admin/pedidos">) {
  return (
    <Suspense fallback={<Loading />}>
      <Orders searchParams={searchParams} />
    </Suspense>
  );
}

async function Orders({ searchParams }: { searchParams: PageProps<"/admin/pedidos">["searchParams"] }) {
  const { status } = await searchParams;
  const initial = (ORDER_STATUSES as readonly string[]).includes(String(status))
    ? (status as OrderStatus)
    : undefined;
  return (
    <AdminOnly>
      <OrdersScreen initialStatus={initial} />
    </AdminOnly>
  );
}
