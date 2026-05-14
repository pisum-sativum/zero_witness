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
import { compileCircuit } from "./compile-circuit.mjs";

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
let compileState = "pending";
let compileError = null;
let compilePromise = null;

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
  res.json({
    ok: true,
    compileState,
    compileError: compileError?.message ?? null,
  });
});

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

app.get("/debug-crs", async (_req, res) => {
  try {
    const testUrl =
      "https://aztec-ignition.s3.amazonaws.com/MAIN%20IGNITION/flat/g1.dat";
    const response = await fetchWithTimeout(
      testUrl,
      {
        headers: {
          Range: "bytes=0-63",
        },
      },
      10000,
    );

    const ok = response.ok;
    const status = response.status;
    const contentLength = response.headers.get("content-length");
    res.json({ ok, status, contentLength });
  } catch (error) {
    const err = error instanceof Error ? error : new Error("Unknown error");
    res.status(500).json({
      error: err.message,
      name: err.name,
      cause: err.cause instanceof Error ? err.cause.message : undefined,
    });
  }
});

app.get("/debug-circuit", async (_req, res) => {
  try {
    const circuit = await loadCircuit();
    res.json({
      compileState,
      compileError: compileError?.message ?? null,
      noirVersion: circuit?.noir_version ?? null,
      bytecodeLength: circuit?.bytecode?.length ?? 0,
      circuitHash: circuit?.hash ?? null,
      publicInputs:
        circuit?.abi?.parameters?.filter(
          (param) => param?.visibility === "public",
        )?.length ?? 0,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error("Unknown error");
    res.status(500).json({
      error: err.message,
      name: err.name,
      cause: err.cause instanceof Error ? err.cause.message : undefined,
    });
  }
});

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

app.post("/prove", async (req, res) => {
  let step = "start";
  let backend;
  await acquireLock();
  try {
    if (!compilePromise) {
      compilePromise = compileCircuit();
    }
    if (compileState === "pending") {
      try {
        await compilePromise;
        compileState = "ready";
        compileError = null;
        circuitCache = null;
      } catch (error) {
        compileState = "failed";
        compileError =
          error instanceof Error ? error : new Error("Unknown error");
      }
    }
    if (compileState === "failed") {
      return res.status(503).json({
        error: "Circuit compile failed",
        detail: compileError?.message ?? "Unknown error",
      });
    }

    step = "validate";
    const { imageBase64, latitude, longitude } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "imageBase64 is required" });
    }
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return res
        .status(400)
        .json({ error: "latitude and longitude are required" });
    }

    step = "loadCircuit";
    const circuit = await loadCircuit();
    step = "hash";
    const imageHash = computeSafeHash(imageBase64);

    step = "inputs";
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

    step = "backend";
    backend = new BarretenbergBackend(circuit, { threads: 1 });
    const noir = new Noir(circuit);
    step = "execute";
    const { witness } = await noir.execute(inputs);
    step = "prove";
    const { proof, publicInputs } = await backend.generateProof(witness);

    step = "respond";
    return res.json({
      proof: Buffer.from(proof).toString("base64"),
      publicInputs,
      imageHash,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error("Unknown error");
    console.error("Render proof server error:", err);
    return res.status(500).json({
      error: err.message,
      name: err.name,
      step,
      stack: err.stack,
      cause: err.cause instanceof Error ? err.cause.message : undefined,
    });
  } finally {
    if (backend?.destroy) {
      try {
        await backend.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }
    if (global.gc) {
      global.gc();
    }
    releaseLock();
  }
});

const port = Number(process.env.PORT || 4000);

async function startServer() {
  compilePromise = compileCircuit();
  compilePromise
    .then(() => {
      compileState = "ready";
      compileError = null;
      circuitCache = null;
    })
    .catch((error) => {
      compileState = "failed";
      compileError =
        error instanceof Error ? error : new Error("Unknown error");
      console.error("Circuit compile failed:", compileError);
    });
  app.listen(port, "0.0.0.0", () => {
    console.log(`Render proof server running on http://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error("Render proof server failed to start:", error);
  process.exit(1);
});
