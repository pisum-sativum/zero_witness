import * as FileSystem from "expo-file-system/legacy";
import Constants from "expo-constants";
import { Platform } from "react-native";

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

const getDevHost = () => {
  const hostUri =
    (Constants.expoConfig as any)?.hostUri ||
    (Constants.manifest as any)?.debuggerHost ||
    (Constants.manifest2 as any)?.extra?.expoClient?.hostUri;
  if (!hostUri || typeof hostUri !== "string") {
    return null;
  }
  return hostUri.split(":")[0];
};

const defaultHost = Platform.OS === "android" ? "10.0.2.2" : "localhost";
const proofServerUrl =
  (Constants.expoConfig as any)?.extra?.proofServerUrl ||
  (Constants.manifest as any)?.extra?.proofServerUrl ||
  `http://${getDevHost() ?? defaultHost}:5000`;

import * as Crypto from "expo-crypto";

export async function runProof(
  _circuit: Circuit,
  request: ProofRequest,
): Promise<ProofResponse> {
  const imageBase64 = await FileSystem.readAsStringAsync(request.imageUri, {
    encoding: "base64",
  });
  
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    imageBase64
  );
  
  // Convert hex hash to a numeric string compatible with the circuit (first 60 chars)
  const imageHash = BigInt("0x" + digest.substring(0, 60)).toString();

  let response;
  try {
    response = await fetch(`${proofServerUrl}/generate-proof`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        secret_latitude: request.latitude,
        secret_longitude: request.longitude,
        image_hash: imageHash,
        public_boundaries: {
          min_lat: (Math.floor(request.latitude * 10000) - 450).toString(),
          max_lat: (Math.floor(request.latitude * 10000) + 450).toString(),
          min_long: (Math.floor(request.longitude * 10000) - 450).toString(),
          max_long: (Math.floor(request.longitude * 10000) + 450).toString(),
        }
      }),
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error("Unknown error");
    throw new Error(
      `Proof server unreachable at ${proofServerUrl}. ${err.message}`,
    );
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Proof server error (${response.status}): ${text}`);
  }

  const data = (await response.json()) as ProofResponse;
  return data;
}
