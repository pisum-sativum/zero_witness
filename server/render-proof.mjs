import dns from "dns";
import { Agent, setGlobalDispatcher } from "undici";
import express from "express";
import cors from "cors";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import JSBI from "jsbi";
import { Noir } from "@noir-lang/noir_js";
import { BarretenbergBackend } from "@noir-lang/backend_barretenberg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dns.setDefaultResultOrder("ipv4first");
setGlobalDispatcher(
  new Agent({
    connect: {
      family: 4,
    },
  }),
);
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

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/prove", async (req, res) => {
  try {
    const { imageBase64, latitude, longitude } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "imageBase64 is required" });
    }
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return res
        .status(400)
        .json({ error: "latitude and longitude are required" });
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

    const backend = new BarretenbergBackend(circuit);
    const noir = new Noir(circuit);
    const { witness } = await noir.execute(inputs);
    const { proof, publicInputs } = await backend.generateProof(witness);

    return res.json({
      proof: Buffer.from(proof).toString("base64"),
      publicInputs,
      imageHash,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Render proof server error:", error);
    return res.status(500).json({ error: message });
  }
});

const port = Number(process.env.PORT || 4000);
app.listen(port, "0.0.0.0", () => {
  console.log(`Render proof server running on http://localhost:${port}`);
});
