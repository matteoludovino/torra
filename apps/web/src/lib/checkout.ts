"use client";

import type { CartView, Quote, QuoteInput } from "@torra/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./api";

/** The delivery address as typed at checkout (the CEP lives in `Choices.cep`, which prices shipping). */
export interface AddressDraft {
  recipient: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  uf: string;
}

/** What the customer chose for shipping and discount, kept for this tab (checkout picks it up). */
export interface Choices {
  cep?: string;
  uf?: QuoteInput["uf"];
  shippingService?: QuoteInput["shippingService"];
  couponCode?: string;
  address?: AddressDraft;
}

const KEY = "torra:checkout";

/**
 * The choices, remembered in sessionStorage when it works (a private window may refuse: then in memory).
 * The third value says whether the saved ones have been read (forms wait for it to start from them).
 */
export function useChoices(): [Choices, (next: Choices) => void, boolean] {
  const [choices, setChoices] = useState<Choices>({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage exists only in the browser
      if (saved) setChoices(JSON.parse(saved) as Choices);
    } catch {
      // Nothing saved, or no storage: start empty.
    }
    setLoaded(true);
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
    loaded,
  ];
}

/** The server's price for the cart with these choices, refreshed whenever the cart or the choices change. */
export function useQuote(cart: CartView | undefined, choices: Choices) {
  const lines = cart?.lines.map((line) => [line.variantId, line.quantity, line.unitPriceCents]);
  // Only what prices the cart (typing a street name doesn't ask the server again).
  const { cep, uf, shippingService, couponCode } = choices;
  const input: QuoteInput = { cep, uf, shippingService, couponCode };
  return useQuery({
    queryKey: ["quote", input, lines],
    queryFn: () => api<Quote>("/checkout/quote", { body: input }),
    enabled: Boolean(cart && cart.lines.length > 0),
    placeholderData: keepPreviousData,
  });
}
