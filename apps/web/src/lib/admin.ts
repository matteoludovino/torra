"use client";

import type {
  AdminCoupon,
  AdminCustomer,
  AdminDashboard,
  AdminOrderPage,
  AdminOrderView,
  AdminProduct,
  AuditEntryView,
  CouponInput,
  OrderStatus,
  ProductInput,
  ProductUpdate,
  RefundInput,
  StockAdjustment,
  VariantInput,
  VariantUpdate,
} from "@torra/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

const ADMIN = ["admin"] as const;

export function useDashboard() {
  return useQuery({
    queryKey: [...ADMIN, "dashboard"],
    queryFn: () => api<AdminDashboard>("/admin/dashboard"),
  });
}

export function useRetryEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/admin/events/${id}/retry`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: [...ADMIN, "dashboard"] }),
  });
}

export interface OrderFilters {
  status?: OrderStatus;
  q?: string;
}

/** Orders, a page at a time (newest first). */
export function useAdminOrders(filters: OrderFilters) {
  return useInfiniteQuery({
    queryKey: [...ADMIN, "orders", filters],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.q) params.set("q", filters.q);
      if (pageParam) params.set("before", pageParam);
      return api<AdminOrderPage>(`/admin/orders?${params}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next,
  });
}

export function useAdminOrder(id: string) {
  return useQuery({
    queryKey: [...ADMIN, "order", id],
    queryFn: () => api<AdminOrderView>(`/admin/orders/${id}`),
  });
}

export type OrderAction =
  | { kind: "prepare" }
  | { kind: "ship"; trackingCode: string }
  | { kind: "deliver" }
  | { kind: "cancel" }
  | { kind: "reconcile" }
  | { kind: "refunds"; input: RefundInput };

/** A step on an order: the answer is the order as it now stands. */
export function useOrderAction(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: OrderAction) =>
      api<AdminOrderView>(`/admin/orders/${id}/${action.kind}`, {
        method: "POST",
        body:
          action.kind === "ship"
            ? { trackingCode: action.trackingCode }
            : action.kind === "refunds"
              ? action.input
              : undefined,
      }),
    onSuccess: (order) => {
      client.setQueryData([...ADMIN, "order", id], order);
      void client.invalidateQueries({ queryKey: [...ADMIN, "orders"] });
      void client.invalidateQueries({ queryKey: [...ADMIN, "dashboard"] });
    },
  });
}

export function useAdminProducts() {
  return useQuery({
    queryKey: [...ADMIN, "products"],
    queryFn: () => api<AdminProduct[]>("/admin/products"),
  });
}

export type CatalogChange =
  | { kind: "create"; input: ProductInput }
  | { kind: "product"; id: string; input: ProductUpdate }
  | { kind: "variant"; productId: string; input: VariantInput }
  | { kind: "variantUpdate"; id: string; input: VariantUpdate }
  | { kind: "stock"; id: string; input: StockAdjustment };

/** Every catalog change answers with the product as it now stands. */
export function useCatalogChange() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: CatalogChange) => {
      switch (change.kind) {
        case "create":
          return api<AdminProduct>("/admin/products", { body: change.input });
        case "product":
          return api<AdminProduct>(`/admin/products/${change.id}`, { method: "PATCH", body: change.input });
        case "variant":
          return api<AdminProduct>(`/admin/products/${change.productId}/variants`, { body: change.input });
        case "variantUpdate":
          return api<AdminProduct>(`/admin/variants/${change.id}`, { method: "PATCH", body: change.input });
        case "stock":
          return api<AdminProduct>(`/admin/variants/${change.id}/stock`, { body: change.input });
      }
    },
    onSuccess: (product) => {
      client.setQueryData<AdminProduct[]>([...ADMIN, "products"], (list) =>
        list?.some((p) => p.id === product.id)
          ? list.map((p) => (p.id === product.id ? product : p))
          : [...(list ?? []), product],
      );
      void client.invalidateQueries({ queryKey: [...ADMIN, "dashboard"] });
    },
  });
}

export function useAdminCoupons() {
  return useQuery({ queryKey: [...ADMIN, "coupons"], queryFn: () => api<AdminCoupon[]>("/admin/coupons") });
}

export function useCouponChange() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      change: { kind: "create"; input: CouponInput } | { kind: "active"; id: string; active: boolean },
    ) =>
      change.kind === "create"
        ? api<AdminCoupon>("/admin/coupons", { body: change.input })
        : api<AdminCoupon>(`/admin/coupons/${change.id}`, {
            method: "PATCH",
            body: { active: change.active },
          }),
    onSuccess: () => client.invalidateQueries({ queryKey: [...ADMIN, "coupons"] }),
  });
}

export function useAdminCustomers(q: string) {
  return useQuery({
    queryKey: [...ADMIN, "customers", q],
    queryFn: () => api<AdminCustomer[]>(`/admin/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  });
}

export function useAuditLog() {
  return useQuery({ queryKey: [...ADMIN, "audit"], queryFn: () => api<AuditEntryView[]>("/admin/audit") });
}
