import { Buffer } from "buffer";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import JSBI from "jsbi";
import { Noir } from "@noir-lang/noir_js";
import { BarretenbergBackend } from "@noir-lang/backend_barretenberg";

type Circuit = {
  bytecode: string;
};

export type ProofRequest = {
  imageUri: string;
  latitude: number;
  longitude: number;
};

export type ProofResponse = {
  proof: string;
  publicInputs: string[];
  imageHash: string;
};

export async function runProof(
  circuit: Circuit,
  request: ProofRequest,
): Promise<ProofResponse> {
  const base64 = await FileSystem.readAsStringAsync(request.imageUri, {
    encoding: "base64",
  });
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    base64,
  );
  const imageHash = JSBI.BigInt("0x" + hash.substring(0, 60)).toString();

  const lat = Math.floor(request.latitude * 10000);
  const lon = Math.floor(request.longitude * 10000);
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

  const backend = new BarretenbergBackend(circuit as any);
  const noir = new Noir(circuit as any);
  const { witness } = await noir.execute(inputs as any);
  const { proof, publicInputs } = await backend.generateProof(witness as any);

  return {
    proof: Buffer.from(proof).toString("base64"),
    publicInputs: publicInputs as string[],
    imageHash,
  };
}
