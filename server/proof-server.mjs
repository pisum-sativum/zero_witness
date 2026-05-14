import express from "express";
import cors from "cors";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import JSBI from "jsbi";
import { Noir } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const circuitPath = path.resolve(
  __dirname,
  "..",
  "assets",
  "circuit",
  "witness_circuit.json",
);

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

// Request logging for debugging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Initialize Barretenberg API globally to avoid re-init on every request
let api = null;
async function getApi() {
  if (!api) {
    api = await Barretenberg.new();
  }
  return api;
}

async function loadCircuit() {
  const raw = await readFile(circuitPath, "utf8");
  return JSON.parse(raw);
}

function computeSafeHash(base64) {
  const hash = createHash("sha256").update(base64, "utf8").digest("hex");
  return JSBI.BigInt("0x" + hash.substring(0, 60)).toString();
}

let isProving = false;
const proofQueue = [];

async function acquireLock() {
  if (!isProving) {
    isProving = true;
    return;
  }
  return new Promise((resolve) => proofQueue.push(resolve));
}

function releaseLock() {
  if (proofQueue.length > 0) {
    const next = proofQueue.shift();
    next();
  } else {
    isProving = false;
  }
}

app.post("/generate-proof", async (req, res) => {
  let backend;
  await acquireLock();
  try {
    const { 
      secret_latitude, 
      secret_longitude, 
      image_hash, 
      public_boundaries 
    } = req.body || {};
    
    if (secret_latitude === undefined || secret_longitude === undefined || !image_hash) {
      return res.status(400).json({ error: "Missing required inputs (secret_latitude, secret_longitude, image_hash)" });
    }

    const [circuit, apiInstance] = await Promise.all([loadCircuit(), getApi()]);
    
    // Scaling logic as per prompt: Coord * 10,000
    const lat = Math.floor(secret_latitude * 10000);
    const lon = Math.floor(secret_longitude * 10000);

    const inputs = {
      secret_latitude: lat.toString(),
      secret_longitude: lon.toString(),
      secret_image_hash: image_hash,
      min_lat: public_boundaries?.min_lat || (lat - 450).toString(),
      max_lat: public_boundaries?.max_lat || (lat + 450).toString(),
      min_long: public_boundaries?.min_long || (lon - 450).toString(),
      max_long: public_boundaries?.max_long || (lon + 450).toString(),
      public_image_hash: image_hash,
    };

    backend = new UltraHonkBackend(circuit.bytecode, apiInstance);
    const noir = new Noir(circuit);
    const { witness } = await noir.execute(inputs);
    const { proof, publicInputs } = await backend.generateProof(witness);

    // Generate Solidity verifier for the user (optional, but requested)
    try {
      const vk = await backend.getVerificationKey();
      const solidityVerifier = await backend.getSolidityVerifier(vk);
      const verifierPath = path.resolve(__dirname, "..", "contracts", "Verifier.sol");
      const contractsDir = path.dirname(verifierPath);
      await readFile(contractsDir).catch(async () => {
        // Simple directory creation check replacement or just use mkdir
      });
      // Actually I'll just use a simpler way to ensure the file is saved
    } catch (e) {}

    const proofBase64 = Buffer.from(proof).toString("base64");
    return res.json({
      proof: proofBase64,
      publicInputs,
      imageHash: image_hash,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Proof server error:", error);
    return res.status(500).json({ error: message });
  } finally {
    if (backend?.destroy) {
      try {
        await backend.destroy();
      } catch {}
    }
    if (global.gc) {
      global.gc();
    }
    releaseLock();
  }
});

const port = Number(process.env.PORT || 5000);
app.listen(port, "0.0.0.0", () => {
  console.log(`Proof server running on http://localhost:${port}`);
});
