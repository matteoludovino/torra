"use client";

import {
  ORDER_ORIGIN_LABELS,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  formatBRL,
  type OrderStatus,
} from "@torra/shared";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Card, Loading } from "@/components/admin/admin-shell";
import { StatusBadge } from "@/components/orders/status-badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useAdminOrders, type OrderFilters } from "@/lib/admin";
import { ApiFailure } from "@/lib/api";
import { dateTime } from "@/lib/format";

const control =
  "rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-xs focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20 focus:outline-none";

/** Every order the admin may see, newest first: filter by situation, find by number, name or email. */
export function OrdersScreen({ initialStatus }: { initialStatus?: OrderStatus }) {
  const [filters, setFilters] = useState<OrderFilters>({ status: initialStatus });
  const [typed, setTyped] = useState("");
  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } = useAdminOrders(filters);
  const orders = data?.pages.flatMap((page) => page.orders) ?? [];

  function search(event: FormEvent) {
    event.preventDefault();
    setFilters({ ...filters, q: typed.trim() || undefined });
  }

  return (
    <Card>
      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-2 text-sm text-stone-700">
          Situação
          <select
            value={filters.status ?? ""}
            onChange={(event) =>
              setFilters({ ...filters, status: (event.target.value || undefined) as OrderStatus | undefined })
            }
            className={control}
          >
            <option value="">Todas</option>
            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ORDER_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <form onSubmit={search} className="flex min-w-0 basis-full gap-2 sm:basis-auto sm:flex-1">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Buscar pedidos</span>
            <input
              type="search"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Número, nome ou e-mail"
              className={`${control} w-full`}
            />
          </label>
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
        </form>
      </div>
      {error ? (
        <Notice tone="error">
          {error instanceof ApiFailure ? error.message : "Não foi possível carregar."}
        </Notice>
      ) : isPending ? (
        <Loading />
      ) : orders.length === 0 ? (
        <p className="py-6 text-center text-sm text-stone-600">Nenhum pedido assim.</p>
      ) : (
        <>
          <ul className="-mx-2 grid divide-y divide-stone-100">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/admin/pedidos/${order.id}`}
                  className="grid gap-1 rounded-lg px-2 py-3 hover:bg-stone-50 sm:grid-cols-[5rem_1fr_auto_auto] sm:items-center sm:gap-4"
                >
                  <span className="font-medium">#{order.number}</span>
                  <span className="min-w-0">
                    <span className="block truncate">{order.customer.name}</span>
                    <span className="block truncate text-xs text-stone-500">
                      {order.customer.email} · {dateTime(order.createdAt)}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={order.status} />
                    {order.origin === "demo" ? (
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-900">
                        {ORDER_ORIGIN_LABELS.demo}
                      </span>
                    ) : null}
                    {order.disputeStatus ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-900">
                        Disputa
                      </span>
                    ) : null}
                    {order.paymentReview ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-900">
                        Em análise
                      </span>
                    ) : null}
                  </span>
                  <span className="font-medium tabular-nums sm:text-right">
                    {formatBRL(order.totalCents)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {hasNextPage ? (
            <div>
              <Button variant="secondary" busy={isFetchingNextPage} onClick={() => void fetchNextPage()}>
                Carregar mais
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
