// Prints the product catalogue row as the admin route stores it, for
// scripts/engine-override-db.sh: the default prices + the overrides given as
// JSON ({ product: { engine, model } }). `--plain` prints JSON.stringify(prices)
// (the pre-E2 bytes). Mock-free: defaults only.
import { noEngineOverrides } from "../../../../lib/engine-override";
import { DEFAULT_PRODUCT_CATALOGUE } from "../../../../lib/product-catalogue";
import { serializeCatalogueRow } from "../../../../lib/product-catalogue-row";

const arg = process.argv[2] ?? "{}";
process.stdout.write(
  arg === "--plain"
    ? JSON.stringify(DEFAULT_PRODUCT_CATALOGUE)
    : serializeCatalogueRow(DEFAULT_PRODUCT_CATALOGUE, { ...noEngineOverrides(), ...JSON.parse(arg) }),
);
