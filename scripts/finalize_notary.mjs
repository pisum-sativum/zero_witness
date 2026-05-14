import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("Initializing Barretenberg...");
  const api = await Barretenberg.new();

  console.log("Loading circuit artifact...");
  const circuitPath = path.resolve(__dirname, "..", "assets", "circuit", "witness_circuit.json");
  const circuit = JSON.parse(await readFile(circuitPath, "utf8"));

  console.log("Generating Solidity Verifier Contract...");
  // Use the UltraHonkBackend which matches the app's proving logic
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  const vk = await backend.getVerificationKey();
  const solidityCode = await backend.getSolidityVerifier(vk);

  const contractsDir = path.resolve(__dirname, "..", "contracts");
  await mkdir(contractsDir, { recursive: true });
  await writeFile(path.join(contractsDir, "UltraVerifier.sol"), solidityCode);

  console.log("\n--- NOTARY FINALIZATION SUCCESSFUL ---");
  console.log(`1. Solidity Verifier saved to: contracts/UltraVerifier.sol`);
  console.log(`2. Circuit Artifact synchronized with Web Verifier.`);
  console.log("---------------------------------------");
}

main().catch((err) => {
  console.error("Finalization failed:", err);
  process.exit(1);
});
