import { CATEGORIES, catalogFilters, type ProductSummary } from "@torra/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ProductGrid } from "@/components/catalog/product-grid";
import { Unavailable } from "@/components/unavailable";
import { serverGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Loja" };

export default function StorePage({ searchParams }: PageProps<"/loja">) {
  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Loja</h1>
      <Suspense fallback={<GridSkeleton />}>
        <Store searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function Store({ searchParams }: { searchParams: PageProps<"/loja">["searchParams"] }) {
  const params = await searchParams;
  const parsed = catalogFilters.safeParse({ categoria: one(params.categoria), busca: one(params.busca) });
  const filters = parsed.success ? parsed.data : {};
  const query = new URLSearchParams();
  if (filters.categoria) query.set("categoria", filters.categoria);
  if (filters.busca) query.set("busca", filters.busca);
  const result = await serverGet<ProductSummary[]>(`/catalog?${query}`);

  const tab = (slug?: string) => {
    const next = new URLSearchParams();
    if (slug) next.set("categoria", slug);
    if (filters.busca) next.set("busca", filters.busca);
    const href = `/loja${next.size ? `?${next}` : ""}`;
    const active = filters.categoria === slug;
    return (
      <Link
        key={slug ?? "all"}
        href={href}
        aria-current={active ? "page" : undefined}
        className="rounded-full border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:border-brand-400 aria-[current=page]:border-brand-700 aria-[current=page]:bg-brand-700 aria-[current=page]:text-white"
      >
        {slug ? CATEGORIES.find((c) => c.slug === slug)!.label : "Tudo"}
      </Link>
    );
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Categorias" className="flex flex-wrap gap-2">
          {tab()}
          {CATEGORIES.map((category) => tab(category.slug))}
        </nav>
        <form action="/loja" role="search" className="flex w-full gap-2 sm:w-auto">
          {filters.categoria ? <input type="hidden" name="categoria" value={filters.categoria} /> : null}
          <label className="min-w-0 flex-1">
            <span className="sr-only">Buscar na loja</span>
            <input
              type="search"
              name="busca"
              defaultValue={filters.busca}
              maxLength={80}
              placeholder="Buscar: bourbon, coador, espresso…"
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-xs focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20 focus:outline-none sm:w-72"
            />
          </label>
          <button className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">
            Buscar
          </button>
        </form>
      </div>
      {result.status !== "ok" ? (
        <Unavailable />
      ) : result.data.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-stone-600">
          Nada encontrado{filters.busca ? ` para “${filters.busca}”` : ""}.{" "}
          <Link href="/loja" className="font-medium text-brand-700 hover:underline">
            Ver tudo
          </Link>
        </p>
      ) : (
        <ProductGrid products={result.data} />
      )}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div aria-busy className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {[0, 1, 2, 3].map((n) => (
        <div key={n} className="aspect-[3/4] animate-pulse rounded-2xl bg-stone-200/70" />
      ))}
    </div>
  );
}
