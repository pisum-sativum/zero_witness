import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import JSBI from "jsbi";
import { Noir } from "@noir-lang/noir_js";
import { BarretenbergBackend } from "@noir-lang/backend_barretenberg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const circuitPath = path.resolve(
  __dirname,
  "assets",
  "circuit",
  "witness_circuit.json"
);

function computeSafeHash(base64) {
  const hash = createHash("sha256").update(base64, "utf8").digest("hex");
  return JSBI.BigInt("0x" + hash.substring(0, 60)).toString();
}

async function run() {
  const raw = await readFile(circuitPath, "utf8");
  const circuit = JSON.parse(raw);

  const backend = new BarretenbergBackend(circuit, { threads: 1 });
  const noir = new Noir(circuit);

  for (let i = 0; i < 2; i++) {
    const imageHash = computeSafeHash("testbase64" + i);
    const lat = Math.floor(40.7128 * 10000);
    const lon = Math.floor(-74.0060 * 10000);
    const inputs = {
      secret_latitude: lat.toString(),
      secret_longitude: lon.toString(),
      secret_image_hash: imageHash,
      min_lat: (lat - 10).toString(),
      max_lat: (lat + 10).toString(),
      min_long: (lon - 10).toString(),
      max_long: (lon + 10).toString(),
      public_image_hash: imageHash,
    };

    console.log("Generating proof", i);
    const { witness } = await noir.execute(inputs);
    const { proof } = await backend.generateProof(witness);
    console.log("Proof", i, "generated, length:", proof.length);
  }
  await backend.destroy();
  console.log("Success");
}

run().catch(console.error);
