import { createWriteStream, promises as fs } from "fs";
import https from "https";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const nargoVersion = "v0.36.0";
const nargoArchiveUrl =
  "https://github.com/noir-lang/noir/releases/download/v0.36.0/nargo-x86_64-unknown-linux-gnu.tar.gz";

const cacheDir = path.join(repoRoot, ".cache", "nargo");
const archivePath = path.join(cacheDir, "nargo.tar.gz");
const versionPath = path.join(cacheDir, "VERSION");

const circuitDir = path.join(repoRoot, "noir", "witness_circuit");
const compiledCircuitPath = path.join(
  repoRoot,
  "assets",
  "circuit",
  "witness_circuit.json",
);

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(targetPath) {
  if (!(await fileExists(targetPath))) {
    return null;
  }
  const raw = await fs.readFile(targetPath, "utf8");
  return JSON.parse(raw);
}

async function findNargoBinary(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === "nargo") {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const result = await findNargoBinary(fullPath);
      if (result) {
        return result;
      }
    }
  }
  return null;
}

async function ensureNargo() {
  await fs.mkdir(cacheDir, { recursive: true });

  let currentVersion = null;
  if (await fileExists(versionPath)) {
    currentVersion = (await fs.readFile(versionPath, "utf8")).trim();
  }

  if (currentVersion !== nargoVersion) {
    await downloadToFile(nargoArchiveUrl, archivePath);
    await execFileAsync("tar", ["-xzf", archivePath, "-C", cacheDir]);
    await fs.writeFile(versionPath, nargoVersion, "utf8");
  }

  const nargoPath = await findNargoBinary(cacheDir);
  if (!nargoPath) {
    throw new Error("nargo binary not found after extraction.");
  }

  await fs.chmod(nargoPath, 0o755);
  return nargoPath;
}

function downloadToFile(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("Too many redirects while downloading nargo."));
      return;
    }

    https
      .get(url, (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          downloadToFile(response.headers.location, destination, redirects + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (status !== 200) {
          reject(
            new Error(`Download failed: ${status} ${response.statusMessage}`),
          );
          return;
        }

        const fileStream = createWriteStream(destination);
        response.pipe(fileStream);
        fileStream.on("finish", () => fileStream.close(resolve));
        fileStream.on("error", reject);
      })
      .on("error", reject);
  });
}

export async function compileCircuit() {
  if (process.platform !== "linux") {
    console.log("Skipping circuit compile: non-Linux platform.");
    return;
  }

  const existingCircuit = await readJsonIfExists(compiledCircuitPath);
  if (existingCircuit?.noir_version?.startsWith("0.36.0")) {
    console.log("Circuit already compiled for Noir 0.36.0.");
    return;
  }

  const nargoPath = await ensureNargo();
  await execFileAsync(nargoPath, ["compile"], { cwd: circuitDir });

  const compiledSource = path.join(
    circuitDir,
    "target",
    "witness_circuit.json",
  );

  await fs.copyFile(compiledSource, compiledCircuitPath);
  console.log("Circuit compiled and copied to assets.");
}

if (process.argv[1] === __filename) {
  compileCircuit().catch((error) => {
    console.error("Circuit compile failed:", error);
    process.exit(1);
  });
}
