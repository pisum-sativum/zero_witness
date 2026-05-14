import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import zlib from "zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("Initializing Barretenberg...");
  const api = await Barretenberg.new();

  console.log("Loading circuit...");
  const circuitPath = path.resolve(__dirname, "..", "assets", "circuit", "witness_circuit.json");
  const circuitRaw = await readFile(circuitPath, "utf8");
  const circuit = JSON.parse(circuitRaw);

  console.log("Generating Solidity Verifier...");
  
  // Try passing the raw base64 string first (bb.js handles decompression)
  let backend;
  try {
    backend = new UltraHonkBackend(circuit.bytecode, api);
    const vk = await backend.getVerificationKey();
    const solidityCode = await backend.getSolidityVerifier(vk);
    
    const outputPath = path.resolve(__dirname, "..", "contracts", "Verifier.sol");
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, solidityCode);
    console.log(`\nSUCCESS: Solidity verifier saved to ${outputPath}`);
  } catch (err) {
    console.log("Standard initialization failed, trying manual decompression...");
    const gzipBytecode = Buffer.from(circuit.bytecode, "base64");
    let decompressed;
    try {
      decompressed = zlib.gunzipSync(gzipBytecode);
    } catch (e) {
      decompressed = zlib.inflateSync(gzipBytecode);
    }
    
    backend = new UltraHonkBackend(decompressed.toString("base64"), api);
    const vk = await backend.getVerificationKey();
    const solidityCode = await backend.getSolidityVerifier(vk);
    
    const outputPath = path.resolve(__dirname, "..", "contracts", "Verifier.sol");
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, solidityCode);
    console.log(`\nSUCCESS (Manual Decompression): Solidity verifier saved to ${outputPath}`);
  }
}

main().catch(console.error);
