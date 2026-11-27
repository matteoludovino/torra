import type { Metadata } from "next";
import { DemoInbox } from "./demo-inbox";

export const metadata: Metadata = { title: "E-mails da demo" };

export default function DemoEmailsPage() {
  return <DemoInbox />;
}
