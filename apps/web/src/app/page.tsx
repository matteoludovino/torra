import { ServerStatus } from "@/components/server-status";
import { ButtonLink } from "@/components/ui/button";

const SHELVES = [
  { title: "Cafés especiais", text: "Torrados na semana, em grãos ou moídos para o seu método." },
  { title: "Utensílios", text: "Moedores, coadores e chaleiras para acertar a extração." },
  { title: "Cursos e e-books", text: "Do primeiro coado ao espresso, com acesso na hora da compra." },
];

export default function Home() {
  return (
    <main className="mx-auto grid max-w-4xl gap-10 px-4 py-12 sm:py-16">
      <div className="grid gap-5">
        <p className="text-sm font-semibold tracking-wide text-brand-700 uppercase">Torrefação Torra</p>
        <h1 className="text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl">
          Café especial, do grão à xícara.
        </h1>
        <p className="max-w-2xl text-lg text-stone-700">
          Cafés torrados na semana, os utensílios para prepará-los e cursos para fazer um café melhor em casa.
        </p>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/cadastro">Criar conta</ButtonLink>
          <ButtonLink href="/entrar" variant="secondary">
            Entrar
          </ButtonLink>
        </div>
        <ServerStatus />
      </div>
      <ul className="grid gap-4 sm:grid-cols-3">
        {SHELVES.map((shelf) => (
          <li
            key={shelf.title}
            className="grid content-start gap-1.5 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
          >
            <h2 className="font-semibold text-brand-900">{shelf.title}</h2>
            <p className="text-sm text-stone-600">{shelf.text}</p>
          </li>
        ))}
      </ul>
      <p className="text-sm text-stone-500">A loja abre em breve: o catálogo chega na próxima versão.</p>
    </main>
  );
}
