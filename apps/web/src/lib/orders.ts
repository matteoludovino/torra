"use client";

import type { FAKE_OUTCOMES, OrderSummary, OrderView, PlaceOrderInput } from "@torra/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { CART_KEY } from "./cart";

export const ORDERS_KEY = ["orders"] as const;

export function useOrders() {
  return useQuery({ queryKey: ORDERS_KEY, queryFn: () => api<OrderSummary[]>("/orders") });
}

/** An order; while its payment is processing, asked again every few seconds (it settles on its own). */
export function useOrder(id: string) {
  return useQuery({
    queryKey: [...ORDERS_KEY, id],
    queryFn: () => api<OrderView>(`/orders/${id}`),
    refetchInterval: (query) => {
      const order = query.state.data;
      return order?.status === "pending_payment" && paymentProcessing(order) ? 15_000 : false;
    },
  });
}

export function paymentProcessing(order: OrderView): boolean {
  return order.events.some((event) => event.type === "payment_processing");
}

/** Places the order (or gets the same one back): the order's page then reads it from the cache. */
export function usePlaceOrder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: PlaceOrderInput) => api<OrderView>("/orders", { body: input }),
    onSuccess: (order) => {
      client.setQueryData([...ORDERS_KEY, order.id], order);
      void client.invalidateQueries({ queryKey: ORDERS_KEY, exact: true });
    },
    // A refusal may mean the cart changed (stock, prices): show it as it is now.
    onError: () => void client.invalidateQueries({ queryKey: CART_KEY }),
  });
}

export function useCancelOrder(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<OrderView>(`/orders/${id}/cancel`, { method: "POST" }),
    onSuccess: (order) => {
      client.setQueryData([...ORDERS_KEY, id], order);
      void client.invalidateQueries({ queryKey: ORDERS_KEY, exact: true });
      void client.invalidateQueries({ queryKey: CART_KEY });
    },
  });
}

/** Asks the server to check with Stripe now (back from the card form), and keeps the answer. */
export function useSyncPayment(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<OrderView>(`/orders/${id}/payment/sync`, { method: "POST" }),
    onSuccess: (order) => {
      client.setQueryData([...ORDERS_KEY, id], order);
      if (order.status !== "pending_payment") {
        void client.invalidateQueries({ queryKey: ORDERS_KEY, exact: true });
        // A paid order's lines leave the cart.
        void client.invalidateQueries({ queryKey: CART_KEY });
      }
    },
  });
}

/** The fake gateway's card form (development and end-to-end runs). */
export function useSimulatePayment(id: string) {
  return useMutation({
    mutationFn: (outcome: (typeof FAKE_OUTCOMES)[number]) =>
      api<{ error: string | null }>(`/orders/${id}/payment/simulate`, { body: { outcome } }),
  });
}
