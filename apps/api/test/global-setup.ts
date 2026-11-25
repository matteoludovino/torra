import { prepareDatabase } from "../scripts/prepare-db.ts";

export default async function setup() {
  await prepareDatabase(
    process.env["TEST_DATABASE_URL"] ?? "postgresql://torra:torra@localhost:5440/torra_test",
  );
}
