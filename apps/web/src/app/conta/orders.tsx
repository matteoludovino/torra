"use client";

import { formatBRL } from "@torra/shared";
import Link from "next/link";
import { StatusBadge } from "@/components/orders/status-badge";
import { Notice } from "@/components/ui/notice";
import { ApiFailure } from "@/lib/api";
import { dateTime, plural } from "@/lib/format";
import { useOrders } from "@/lib/orders";

/** The customer's orders, newest first. */
export function Orders() {
  const { data: orders, error } = useOrders();
  return (
    <section className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Pedidos</h2>
      {error ? (
        <Notice tone="error">
          {error instanceof ApiFailure ? error.message : "Não foi possível carregar seus pedidos."}
        </Notice>
      ) : !orders ? (
        <div aria-busy className="h-16 animate-pulse rounded-lg bg-stone-200/70" />
      ) : orders.length === 0 ? (
        <p className="text-sm text-stone-600">Seus pedidos aparecem aqui depois da primeira compra.</p>
      ) : (
        <ul className="-mx-2 grid">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/pedidos/${order.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 hover:bg-stone-100"
              >
                <span className="font-medium text-stone-900">#{order.number}</span>
                <StatusBadge status={order.status} />
                <span className="ml-auto font-medium">{formatBRL(order.totalCents)}</span>
                <span className="basis-full text-xs text-stone-500">
                  {dateTime(order.createdAt)} · {plural(order.items, "item", "itens")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
