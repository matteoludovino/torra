"use client";

import type { CartView, Quote, QuoteInput } from "@torra/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./api";

/** What the customer chose for shipping and discount, kept for this tab (checkout picks it up). */
export interface Choices {
  cep?: string;
  uf?: QuoteInput["uf"];
  shippingService?: QuoteInput["shippingService"];
  couponCode?: string;
}

const KEY = "torra:checkout";

/** The choices, remembered in sessionStorage when it works (a private window may refuse: then in memory). */
export function useChoices(): [Choices, (next: Choices) => void] {
  const [choices, setChoices] = useState<Choices>({});
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage exists only in the browser
      if (saved) setChoices(JSON.parse(saved) as Choices);
    } catch {
      // Nothing saved, or no storage: start empty.
    }
  }, []);
  return [
    choices,
    (next) => {
      setChoices(next);
      try {
        sessionStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Storage refused: the choices still hold until the page closes.
      }
    },
  ];
}

/** The server's price for the cart with these choices, refreshed whenever the cart or the choices change. */
export function useQuote(cart: CartView | undefined, choices: Choices) {
  const lines = cart?.lines.map((line) => [line.variantId, line.quantity, line.unitPriceCents]);
  return useQuery({
    queryKey: ["quote", choices, lines],
    queryFn: () => api<Quote>("/checkout/quote", { body: choices }),
    enabled: Boolean(cart && cart.lines.length > 0),
    placeholderData: keepPreviousData,
  });
}
