"use client";

import type { OrderSummary, OrderView, PlaceOrderInput } from "@torra/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { CART_KEY } from "./cart";

export const ORDERS_KEY = ["orders"] as const;

export function useOrders() {
  return useQuery({ queryKey: ORDERS_KEY, queryFn: () => api<OrderSummary[]>("/orders") });
}

export function useOrder(id: string) {
  return useQuery({ queryKey: [...ORDERS_KEY, id], queryFn: () => api<OrderView>(`/orders/${id}`) });
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
