import { ServerStatus } from "./server-status";

/** The API didn't answer (a free server waking up, most likely): say so, and keep checking. */
export function Unavailable() {
  return (
    <div className="grid justify-items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
      <p className="font-medium">Não conseguimos carregar a loja agora.</p>
      <p className="text-sm">O servidor pode estar acordando: recarregue a página em alguns segundos.</p>
      <ServerStatus />
    </div>
  );
}
