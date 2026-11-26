"use client";

import { formatBRL, type OrderView, type PaymentStart } from "@torra/shared";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { api, ApiFailure } from "@/lib/api";
import { ORDERS_KEY, useSimulatePayment, useSyncPayment } from "@/lib/orders";

/** Stripe.js, loaded once per key for the whole app (as Stripe recommends), and only on this page. */
const stripes = new Map<string, Promise<Stripe | null>>();
function stripeFor(key: string): Promise<Stripe | null> {
  let stripe = stripes.get(key);
  if (!stripe) {
    stripe = loadStripe(key);
    stripes.set(key, stripe);
  }
  return stripe;
}

/** The card form for an order waiting for payment. */
export function PaymentPanel({ order }: { order: OrderView }) {
  const client = useQueryClient();
  // Starting is safe to repeat: the order has one PaymentIntent, made once.
  const { data: start, error } = useQuery({
    queryKey: ["payment", order.id],
    queryFn: () => api<PaymentStart>(`/orders/${order.id}/payment`, { method: "POST" }),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  // Nothing to fill in (free, or already settled): the order has moved on.
  useEffect(() => {
    if (start?.kind === "free" || start?.kind === "settled") {
      void client.invalidateQueries({ queryKey: [...ORDERS_KEY, order.id] });
    }
  }, [start, client, order.id]);

  if (error) {
    return (
      <Notice tone="error">
        {error instanceof ApiFailure ? error.message : "Não foi possível iniciar o pagamento."}
      </Notice>
    );
  }
  if (!start || start.kind === "free" || start.kind === "settled") {
    return <div aria-busy className="h-40 animate-pulse rounded-xl bg-stone-200/70" />;
  }
  if (start.kind === "fake") return <SimulatedCard orderId={order.id} amountCents={start.amountCents} />;
  return (
    <Elements
      stripe={stripeFor(start.publishableKey!)}
      options={{
        clientSecret: start.clientSecret,
        locale: "pt-BR",
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#894520",
            fontFamily: "Inter, system-ui, sans-serif",
            borderRadius: "8px",
          },
        },
      }}
    >
      <CardForm orderId={order.id} amountCents={start.amountCents} />
    </Elements>
  );
}

/** Stripe's Payment Element: the card, 3-D Secure in place, and the decline messages Stripe writes. */
function CardForm({ orderId, amountCents }: { orderId: string; amountCents: number }) {
  const stripe = useStripe();
  const elements = useElements();
  const sync = useSyncPayment(orderId);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setProblem(null);
    const { error } = await stripe.confirmPayment({
      elements,
      // Only for a payment that has to leave the page; cards confirm here, 3-D Secure included.
      confirmParams: { return_url: new URL(`/pedidos/${orderId}`, location.origin).href },
      redirect: "if_required",
    });
    if (error) {
      setProblem(error.message ?? "Não foi possível concluir o pagamento.");
      setBusy(false);
      return;
    }
    // Stripe took it: the server checks with Stripe and the page follows.
    sync.mutate(undefined, { onSettled: () => setBusy(false) });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <PaymentElement onReady={() => setReady(true)} options={{ layout: "tabs" }} />
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <Button type="submit" busy={busy} disabled={!stripe || !ready}>
        Pagar {formatBRL(amountCents)}
      </Button>
      <TestCards />
    </form>
  );
}

function TestCards() {
  return (
    <div className="grid gap-1 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600">
      <p className="font-medium text-stone-800">Stripe em modo de teste: nada é cobrado de verdade.</p>
      <p>
        Aprovado: <code>4242 4242 4242 4242</code> · com 3-D Secure: <code>4000 0027 6000 3184</code> ·
        recusado: <code>4000 0000 0000 0002</code>. Qualquer validade futura e qualquer CVC.
      </p>
    </div>
  );
}

/**
 * Without Stripe keys (development and end-to-end runs) a simulated card stands in: the server's fake
 * gateway does what's chosen here and sends the event Stripe would.
 */
function SimulatedCard({ orderId, amountCents }: { orderId: string; amountCents: number }) {
  const simulate = useSimulatePayment(orderId);
  const sync = useSyncPayment(orderId);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = simulate.isPending || sync.isPending;

  function choose(outcome: "succeed" | "decline" | "process") {
    setProblem(null);
    simulate.mutate(outcome, {
      onSuccess: ({ error }) => {
        setProblem(error);
        sync.mutate();
      },
      onError: (error) =>
        setProblem(error instanceof ApiFailure ? error.message : "Não foi possível simular."),
    });
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-stone-600">
        Pagamento simulado: este ambiente não tem o Stripe configurado. Escolha o que acontece com o cartão (
        {formatBRL(amountCents)}).
      </p>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button busy={busy} onClick={() => choose("succeed")}>
          Aprovar pagamento
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => choose("decline")}>
          Cartão recusado
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => choose("process")}>
          Deixar em processamento
        </Button>
      </div>
    </div>
  );
}
