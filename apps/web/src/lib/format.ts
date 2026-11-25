import { formatBRL } from "@torra/shared";

/** "R$ 4.000" for whole reais, "R$ 4.000,50" otherwise. */
export function money(cents: number): string {
  const full = formatBRL(cents);
  return cents % 100 === 0 ? full.replace(/,00$/, "") : full;
}

export function budget(min: number, max: number): string {
  return min === max ? money(min) : `${money(min)} a ${money(max)}`;
}

const relative = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

/** "hoje", "ontem", "há 3 dias", "há 2 meses". */
export function ago(iso: string, now = Date.now()): string {
  const days = Math.round((new Date(iso).getTime() - now) / 86_400_000);
  if (days > -1) return "hoje";
  if (days > -30) return relative.format(days, "day");
  return relative.format(Math.round(days / 30), "month");
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

const day = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});
const dayTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/** "24/11" */
export function shortDate(iso: string): string {
  return day.format(new Date(iso));
}

/** "24/11, 14:30" */
export function dateTime(iso: string): string {
  return dayTime.format(new Date(iso));
}

/** "em 3 dias", "amanhã", "hoje" for a time ahead. */
export function inTime(iso: string, now = Date.now()): string {
  const hours = (new Date(iso).getTime() - now) / 3_600_000;
  if (hours < 24) return hours < 1 ? "em menos de 1 hora" : `em ${Math.floor(hours)} h`;
  return relative.format(Math.round(hours / 24), "day");
}
