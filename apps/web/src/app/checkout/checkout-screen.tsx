"use client";

import {
  UFS,
  deliveryAddress,
  formatBRL,
  formatCep,
  type CartView,
  type Me,
  type Quote,
} from "@torra/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { QuotePanel } from "@/components/checkout/quote-panel";
import { RequireSession } from "@/components/require-session";
import { Button, ButtonLink } from "@/components/ui/button";
import { Select, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { ApiFailure } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { useChoices, useQuote, type AddressDraft, type Choices } from "@/lib/checkout";
import { validate, without, type FieldErrors } from "@/lib/forms";
import { usePlaceOrder } from "@/lib/orders";

/** Refusals that mean the cart itself needs a look. */
const CART_PROBLEMS = new Set(["cart_not_ready", "out_of_stock", "empty_cart"]);

/** Checkout: where it goes, how it ships, the coupon, a last look; then the order is placed. */
export function CheckoutScreen() {
  return <RequireSession>{(me) => <Checkout me={me} />}</RequireSession>;
}

function Checkout({ me }: { me: Me }) {
  const { data: cart, error } = useCart();
  const [choices, setChoices, loaded] = useChoices();
  const { data: quote } = useQuote(cart, choices);

  if (error) {
    return (
      <Page>
        <Notice tone="error">
          {error instanceof ApiFailure ? error.message : "Não foi possível carregar o carrinho."}
        </Notice>
      </Page>
    );
  }
  if (!cart || !loaded) {
    return (
      <Page>
        <div aria-busy className="h-72 animate-pulse rounded-2xl bg-stone-200/70" />
      </Page>
    );
  }
  if (cart.lines.length === 0) {
    return (
      <Page>
        <div className="grid justify-items-center gap-3 rounded-2xl border border-dashed border-stone-300 p-10 text-center">
          <p className="text-stone-600">Seu carrinho está vazio.</p>
          <ButtonLink href="/loja">Ver a loja</ButtonLink>
        </div>
      </Page>
    );
  }
  if (!cart.ready) {
    return (
      <Page>
        <Notice tone="info">
          <p>Alguns itens do carrinho mudaram (preço ou estoque). Confira antes de continuar.</p>
          <p className="mt-2">
            <Link href="/carrinho" className="font-medium underline underline-offset-2">
              Voltar ao carrinho
            </Link>
          </p>
        </Notice>
      </Page>
    );
  }
  return <Ready me={me} cart={cart} quote={quote} choices={choices} setChoices={setChoices} />;
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-10">
      <div className="grid gap-1">
        <Link href="/carrinho" className="text-sm text-stone-600 hover:underline">
          ← Carrinho
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Finalizar compra</h1>
      </div>
      {children}
    </main>
  );
}

function Ready({
  me,
  cart,
  quote,
  choices,
  setChoices,
}: {
  me: Me;
  cart: CartView;
  quote: Quote | undefined;
  choices: Choices;
  setChoices: (next: Choices) => void;
}) {
  const router = useRouter();
  const place = usePlaceOrder();
  const physical = cart.lines.some((line) => line.product.kind === "physical");
  const draft: AddressDraft = choices.address ?? {
    recipient: me.name,
    street: "",
    number: "",
    complement: "",
    district: "",
    city: "",
    uf: "",
  };
  const [cep, setCep] = useState(choices.cep ? formatCep(choices.cep) : "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const setDraft = (change: Partial<AddressDraft>) => {
    setChoices({ ...choices, address: { ...draft, ...change } });
    setErrors((current) => Object.keys(change).reduce(without, current));
  };

  // The directory's answer for a new CEP fills in the street, district, city and state.
  const filledFor = useRef(choices.address ? choices.cep : undefined);
  // Only the directory's answers (they always name the city): with the directory down, the quote's
  // address is just the state picked by hand.
  const found = quote?.address?.city ? quote.address : undefined;
  useEffect(() => {
    if (!found || found.cep.replace(/\D/g, "") === filledFor.current) return;
    filledFor.current = found.cep.replace(/\D/g, "");
    setChoices({
      ...choices,
      address: {
        ...draft,
        street: found.street || draft.street,
        district: found.district || draft.district,
        city: found.city || draft.city,
        uf: found.uf,
      },
    });
    // Only when the directory's answer changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found]);
  const stateFromCep = Boolean(found && found.cep.replace(/\D/g, "") === choices.cep);

  function changeCep(value: string) {
    setCep(value);
    setErrors((current) => without(current, "cep"));
    const digits = value.replace(/\D/g, "");
    if (digits.length === 8 && digits !== choices.cep) setChoices({ ...choices, cep: digits, uf: undefined });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    let address;
    if (physical) {
      const { data, errors: problems } = validate(deliveryAddress, { ...draft, cep });
      setErrors(problems ?? {});
      if (!data) return;
      address = data;
    }
    try {
      const order = await place.mutateAsync({
        address,
        shippingService: physical ? (quote?.shippingService ?? undefined) : undefined,
        couponCode: quote?.coupon ? quote.coupon.code : undefined,
      });
      router.push(`/pedidos/${order.id}`);
    } catch {
      // Shown below from the mutation's error.
    }
  }

  const failure = place.error instanceof ApiFailure ? place.error : null;
  const busy = place.isPending || place.isSuccess;
  return (
    <Page>
      {/* The panel has forms of its own (the coupon), so the checkout form holds the left column and the
          button points at it. */}
      <div className="grid gap-6 md:grid-cols-[1fr_20rem] md:items-start">
        <form id="checkout" onSubmit={submit} noValidate className="grid gap-6">
          {physical ? (
            <section className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Endereço de entrega</h2>
              <div className="grid gap-4 sm:grid-cols-6">
                <div className="sm:col-span-6">
                  <TextField
                    label="Quem recebe"
                    autoComplete="name"
                    value={draft.recipient}
                    onChange={(event) => setDraft({ recipient: event.target.value })}
                    error={errors.recipient}
                  />
                </div>
                <div className="sm:col-span-2">
                  <TextField
                    label="CEP"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={9}
                    value={cep}
                    onChange={(event) => changeCep(event.target.value)}
                    error={
                      errors.cep ??
                      (quote?.shippingProblem === "unknown_cep" ? "CEP não encontrado." : undefined)
                    }
                    hint={
                      quote?.shippingProblem === "lookup_unavailable"
                        ? "A busca de CEP não respondeu: preencha o endereço."
                        : undefined
                    }
                  />
                </div>
                <div className="sm:col-span-4">
                  <TextField
                    label="Rua"
                    autoComplete="address-line1"
                    value={draft.street}
                    onChange={(event) => setDraft({ street: event.target.value })}
                    error={errors.street}
                  />
                </div>
                <div className="sm:col-span-2">
                  <TextField
                    label="Número"
                    value={draft.number}
                    onChange={(event) => setDraft({ number: event.target.value })}
                    error={errors.number}
                  />
                </div>
                <div className="sm:col-span-4">
                  <TextField
                    label="Complemento (opcional)"
                    autoComplete="address-line2"
                    value={draft.complement}
                    onChange={(event) => setDraft({ complement: event.target.value })}
                    error={errors.complement}
                  />
                </div>
                <div className="sm:col-span-2">
                  <TextField
                    label="Bairro"
                    value={draft.district}
                    onChange={(event) => setDraft({ district: event.target.value })}
                    error={errors.district}
                  />
                </div>
                <div className="sm:col-span-3">
                  <TextField
                    label="Cidade"
                    autoComplete="address-level2"
                    value={draft.city}
                    onChange={(event) => setDraft({ city: event.target.value })}
                    error={errors.city}
                  />
                </div>
                <div className="sm:col-span-1">
                  <Select
                    label="UF"
                    value={draft.uf}
                    disabled={stateFromCep}
                    onChange={(event) => {
                      const uf = event.target.value as Choices["uf"];
                      // Without the directory, the state typed in prices the shipping.
                      setChoices({ ...choices, uf: uf || undefined, address: { ...draft, uf: uf ?? "" } });
                      setErrors((current) => without(current, "uf"));
                    }}
                    error={errors.uf}
                  >
                    <option value="">—</option>
                    {UFS.map((uf) => (
                      <option key={uf}>{uf}</option>
                    ))}
                  </Select>
                </div>
              </div>
            </section>
          ) : (
            <Notice tone="info">
              Só produtos digitais: nada para entregar. Eles ficam na sua conta assim que o pagamento for
              confirmado.
            </Notice>
          )}
          <section className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Itens</h2>
            <ul className="grid gap-2 text-sm">
              {cart.lines.map((line) => (
                <li key={line.variantId} className="flex items-baseline justify-between gap-3">
                  <span>
                    {line.quantity} × {line.product.title}
                    {line.options.length > 0 ? (
                      <span className="text-stone-500">
                        {" "}
                        · {line.options.map((option) => option.value).join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-medium">{formatBRL(line.lineTotalCents)}</span>
                </li>
              ))}
            </ul>
          </section>
        </form>
        <aside className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm md:sticky md:top-6">
          <QuotePanel cart={cart} choices={choices} onChange={setChoices} cepField={false} />
          {failure ? (
            <Notice tone="error">
              {failure.message}
              {CART_PROBLEMS.has(failure.code) ? (
                <>
                  {" "}
                  <Link href="/carrinho" className="font-medium underline underline-offset-2">
                    Ver o carrinho
                  </Link>
                </>
              ) : null}
            </Notice>
          ) : null}
          <Button type="submit" form="checkout" busy={busy} disabled={Boolean(quote?.belowMinimum)}>
            Ir para o pagamento
          </Button>
          <p className="text-xs text-stone-500">
            Ao continuar, os itens ficam guardados para você por 30 minutos enquanto o pagamento não é
            concluído.
          </p>
        </aside>
      </div>
    </Page>
  );
}
