"use client";

import { ORDER_ORIGIN_LABELS, formatBRL } from "@torra/shared";
import { useState, type FormEvent } from "react";
import { Card, Loading } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useAdminCustomers } from "@/lib/admin";
import { ApiFailure } from "@/lib/api";
import { plural, shortDate } from "@/lib/format";

/** Customers, newest first, with what they've ordered and spent. */
export function CustomersScreen() {
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const { data: customers, error } = useAdminCustomers(q);
  function search(event: FormEvent) {
    event.preventDefault();
    setQ(typed.trim());
  }
  return (
    <Card>
      <form onSubmit={search} className="flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Buscar clientes</span>
          <input
            type="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Nome ou e-mail"
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>
      {error ? (
        <Notice tone="error">
          {error instanceof ApiFailure ? error.message : "Não foi possível carregar."}
        </Notice>
      ) : !customers ? (
        <Loading />
      ) : customers.length === 0 ? (
        <p className="py-6 text-center text-sm text-stone-600">Nenhum cliente assim.</p>
      ) : (
        <ul className="grid divide-y divide-stone-100">
          {customers.map((customer) => (
            <li
              key={customer.id}
              className="grid gap-0.5 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {customer.name}
                  {customer.origin === "demo" ? (
                    <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-normal text-violet-900">
                      {ORDER_ORIGIN_LABELS.demo}
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-stone-500">
                  {customer.email}
                  {customer.emailVerified ? " · e-mail confirmado" : ""} · desde{" "}
                  {shortDate(customer.createdAt)}
                </p>
              </div>
              <p className="text-stone-600 tabular-nums sm:text-right">
                {plural(customer.orders, "pedido", "pedidos")} · {formatBRL(customer.spentCents)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
