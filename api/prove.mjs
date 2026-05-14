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
  "..",
  "assets",
  "circuit",
  "witness_circuit.json",
);

let circuitCache = null;

async function loadCircuit() {
  if (circuitCache) {
    return circuitCache;
  }
  const raw = await readFile(circuitPath, "utf8");
  circuitCache = JSON.parse(raw);
  return circuitCache;
}

function computeSafeHash(base64) {
  const hash = createHash("sha256").update(base64, "utf8").digest("hex");
  return JSBI.BigInt("0x" + hash.substring(0, 60)).toString();
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
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

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let backend;
  await acquireLock();

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { imageBase64, latitude, longitude } = body;

    if (!imageBase64 || typeof imageBase64 !== "string") {
      res.status(400).json({ error: "imageBase64 is required" });
      return;
    }
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      res.status(400).json({ error: "latitude and longitude are required" });
      return;
    }

    const circuit = await loadCircuit();
    const imageHash = computeSafeHash(imageBase64);

    const lat = Math.floor(latitude * 10000);
    const lon = Math.floor(longitude * 10000);
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

    backend = new BarretenbergBackend(circuit);
    const noir = new Noir(circuit);
    const { witness } = await noir.execute(inputs);
    const { proof, publicInputs } = await backend.generateProof(witness);

    res.json({
      proof: Buffer.from(proof).toString("base64"),
      publicInputs,
      imageHash,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Proof server error:", error);
    res.status(500).json({ error: message });
  } finally {
    if (backend?.destroy) {
      try {
        await backend.destroy();
      } catch {}
    }
    releaseLock();
  }
}
