import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto grid max-w-md gap-4 px-4 py-20 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Não encontrado</h1>
      <p className="text-stone-600">Esta página não existe, foi removida ou não está visível para você.</p>
      <ButtonLink href="/" variant="secondary" className="justify-self-center">
        Voltar ao início
      </ButtonLink>
    </main>
  );
}
