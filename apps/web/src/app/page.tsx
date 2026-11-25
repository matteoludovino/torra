import { CATEGORIES, type ProductSummary } from "@torra/shared";
import Link from "next/link";
import { Suspense } from "react";
import { ProductGrid } from "@/components/catalog/product-grid";
import { ServerStatus } from "@/components/server-status";
import { ButtonLink } from "@/components/ui/button";
import { Unavailable } from "@/components/unavailable";
import { serverGet } from "@/lib/server-api";

export default function Home() {
  return (
    <main className="mx-auto grid max-w-6xl gap-12 px-4 py-10 sm:py-14">
      <div className="grid gap-5">
        <p className="text-sm font-semibold tracking-wide text-brand-700 uppercase">Torrefação Torra</p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl">
          Café especial, do grão à xícara.
        </h1>
        <p className="max-w-2xl text-lg text-stone-700">
          Cafés torrados na semana, os utensílios para prepará-los e cursos para fazer um café melhor em casa.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink href="/loja">Ver a loja</ButtonLink>
          <ButtonLink href="/loja?categoria=cafes" variant="secondary">
            Cafés da semana
          </ButtonLink>
        </div>
        <ServerStatus />
      </div>
      <Suspense fallback={<div aria-busy className="h-96 animate-pulse rounded-2xl bg-stone-200/70" />}>
        <Shelves />
      </Suspense>
    </main>
  );
}

async function Shelves() {
  const result = await serverGet<ProductSummary[]>("/catalog");
  if (result.status !== "ok") return <Unavailable />;
  return (
    <>
      {CATEGORIES.map((category) => {
        const products = result.data.filter((p) => p.category === category.slug).slice(0, 4);
        if (products.length === 0) return null;
        return (
          <section key={category.slug} aria-labelledby={`shelf-${category.slug}`} className="grid gap-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="grid gap-0.5">
                <h2 id={`shelf-${category.slug}`} className="text-xl font-semibold text-stone-900">
                  {category.label}
                </h2>
                <p className="text-sm text-stone-600">{category.description}</p>
              </div>
              <Link
                href={`/loja?categoria=${category.slug}`}
                className="text-sm font-medium text-brand-700 hover:underline"
              >
                Ver todos →
              </Link>
            </div>
            <ProductGrid products={products} />
          </section>
        );
      })}
    </>
  );
}
