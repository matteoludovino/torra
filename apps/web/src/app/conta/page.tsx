import type { Metadata } from "next";
import { Account } from "./account";

export const metadata: Metadata = { title: "Sua conta" };

export default function AccountPage() {
  return <Account />;
}
