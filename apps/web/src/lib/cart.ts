"use client";

import type { CartView } from "@torra/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export const CART_KEY = ["cart"] as const;

/** The cart (a visitor's or the customer's): one request per page load, shared by every component. */
export function useCart() {
  return useQuery({ queryKey: CART_KEY, queryFn: () => api<CartView>("/cart"), staleTime: 30_000 });
}

/** Every cart change answers with the whole cart: the cache takes it as is. */
export function useCartChange() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: CartChange) => {
      switch (change.kind) {
        case "add":
          return api<CartView>("/cart/items", {
            body: { variantId: change.variantId, quantity: change.quantity },
          });
        case "set":
          return api<CartView>(`/cart/items/${change.variantId}`, {
            method: "PUT",
            body: { quantity: change.quantity },
          });
        case "remove":
          return api<CartView>(`/cart/items/${change.variantId}`, { method: "DELETE" });
        case "acknowledge":
          return api<CartView>("/cart/acknowledge-prices", { method: "POST" });
      }
    },
    onSuccess: (cart) => client.setQueryData(CART_KEY, cart),
  });
}

export type CartChange =
  | { kind: "add"; variantId: string; quantity: number }
  | { kind: "set"; variantId: string; quantity: number }
  | { kind: "remove"; variantId: string }
  | { kind: "acknowledge" };
