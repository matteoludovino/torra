import type { Metadata } from "next";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Nova senha" };

export default function ResetPage() {
  return <ResetForm />;
}
