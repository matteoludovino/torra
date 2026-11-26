import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderScreen } from "./order-screen";

export const metadata: Metadata = { title: "Pedido" };

export default function OrderPage({ params }: PageProps<"/pedidos/[id]">) {
  return (
    <Suspense fallback={null}>
      <Order params={params} />
    </Suspense>
  );
}

async function Order({ params }: { params: PageProps<"/pedidos/[id]">["params"] }) {
  const { id } = await params;
  return <OrderScreen id={id} />;
}
