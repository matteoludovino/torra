import { categoryLabel, type ProductDetail } from "@torra/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductArt } from "@/components/catalog/product-art";
import { Unavailable } from "@/components/unavailable";
import { serverGet } from "@/lib/server-api";
import { VariantPicker } from "./variant-picker";

export const metadata: Metadata = { title: "Produto" };

export default function ProductPage({ params }: PageProps<"/produto/[slug]">) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <Suspense fallback={<div aria-busy className="h-96 animate-pulse rounded-2xl bg-stone-200/70" />}>
        <Product params={params} />
      </Suspense>
    </main>
  );
}

async function Product({ params }: { params: PageProps<"/produto/[slug]">["params"] }) {
  const { slug } = await params;
  const result = await serverGet<ProductDetail>(`/catalog/${encodeURIComponent(slug)}`);
  if (result.status === "not_found") notFound();
  if (result.status === "unavailable") return <Unavailable />;
  const product = result.data;
  return (
    <article className="grid gap-8 md:grid-cols-2 md:items-start">
      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm md:sticky md:top-6">
        <ProductArt art={product.art} slug={product.slug} />
      </div>
      <div className="grid gap-5">
        <nav aria-label="Caminho" className="text-sm text-stone-500">
          <Link href="/loja" className="hover:underline">
            Loja
          </Link>{" "}
          /{" "}
          <Link href={`/loja?categoria=${product.category}`} className="hover:underline">
            {categoryLabel(product.category)}
          </Link>
        </nav>
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
            {product.title}
          </h1>
          <p className="text-stone-700">{product.subtitle}</p>
        </div>
        <VariantPicker product={product} />
        <section className="grid gap-2 border-t border-stone-200 pt-5">
          <h2 className="text-sm font-semibold tracking-wide text-stone-500 uppercase">Sobre</h2>
          <p className="leading-relaxed whitespace-pre-line text-stone-800">{product.description}</p>
        </section>
      </div>
    </article>
  );
}
