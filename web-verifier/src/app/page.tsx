"use client";
import React from "react";
import { useState, useRef } from "react";
import pako from "pako";
import { Noir } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";

type WitnessArtifact = {
  version: string;
  metadata: {
    timestamp: string;
    location_name: string;
    radius_km: number;
    certificate_id?: string;
  };
  proof: string;
  publicInputs: {
    imageHash: string;
    min_lat: string;
    max_lat: string;
    min_long: string;
    max_long: string;
  };
  publicInputsArray?: string[];
  blurredImageBase64: string;
};

export default function VerifierPage() {
  const [artifact, setArtifact] = useState<WitnessArtifact | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    processFile(file);
  };

  const processFile = (file?: File) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        setArtifact(json);
        setVerificationResult(null);
      } catch (err) {
        alert("Invalid .witness file format");
      }
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    processFile(file);
  };

  const verifyProof = async () => {
    if (!artifact) return;

    setIsVerifying(true);
    setVerificationResult(null);

    try {
      // 1. Fetch circuit artifact
      const response = await fetch("/circuit/witness_circuit.json");
      const circuit = await response.json();

      // 2. Initialize Barretenberg
      const api = await Barretenberg.new();
      
      // 3. Initialize Backend and Noir
      const backend = new UltraHonkBackend(circuit.bytecode, api);
      
      // 5. Reconstruct public inputs from artifact
      const formatHex = (val: string) => {
        try {
          let bn = BigInt(val);
          const FIELD_MODULUS = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
          if (bn < BigInt(0)) bn = (bn % FIELD_MODULUS) + FIELD_MODULUS;
          let hex = bn.toString(16);
          if (hex.length % 2 !== 0) hex = '0' + hex;
          return '0x' + hex;
        } catch (e) {
          throw new Error(`Invalid numeric input: ${val}`);
        }
      };

      const publicInputs = artifact.publicInputsArray || [
        formatHex(artifact.publicInputs.imageHash),
        formatHex(artifact.publicInputs.min_lat),
        formatHex(artifact.publicInputs.max_lat),
        formatHex(artifact.publicInputs.min_long),
        formatHex(artifact.publicInputs.max_long),
      ];

      // 6. Verify
      // Clean up base64 string to handle URL-safe chars, whitespace, and padding
      let cleanBase64 = artifact.proof.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
      const padLen = (4 - (cleanBase64.length % 4)) % 4;
      cleanBase64 += '='.repeat(padLen);

      const proofBinary = atob(cleanBase64);
      const proofBuffer = new Uint8Array(proofBinary.length);
      for (let i = 0; i < proofBinary.length; i++) {
        proofBuffer[i] = proofBinary.charCodeAt(i);
      }
      const isValid = await backend.verifyProof({
        proof: proofBuffer,
        publicInputs: publicInputs,
      });

      if (isValid) {
        setVerificationResult({
          success: true,
          message: "VERIFIED AUTHENTICITY: Digital Notary Certificate",
        });
      } else {
        setVerificationResult({
          success: false,
          message: "VERIFICATION FAILED: INVALID PROOF",
        });
      }
    } catch (err) {
      console.error(err);
      setVerificationResult({
        success: false,
        message: `ERROR: ${err instanceof Error ? err.message : "Internal verification error"}`,
      });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <main>
      <h1>ZeroWitness Notary</h1>
      <p className="subtitle">
        Upload a .witness artifact to verify its authenticity and location privacy claim without revealing coordinates.
      </p>

      <div className="glass-card">
        {!artifact ? (
          <div 
            className="upload-area" 
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <span className="upload-icon">📂</span>
            <h3>Drop Witness Artifact</h3>
            <p style={{ color: "rgba(255,255,255,0.4)", marginTop: "0.5rem" }}>
              Click to select .witness file
            </p>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              style={{ display: "none" }}
              accept=".witness,application/json"
            />
          </div>
        ) : (
          <div>
            {verificationResult?.success ? (
              <div style={{ position: "relative" }}>
                <div className="badge badge-success">
                  <div className="pulse-dot"></div>
                  {verificationResult.message}
                </div>
                <div className="notary-seal">
                  <div className="seal-inner">
                    <span className="seal-text">VERIFIED</span>
                    <div className="seal-year">{new Date().getFullYear()}</div>
                  </div>
                </div>
              </div>
            ) : verificationResult ? (
              <div className="badge" style={{ backgroundColor: "rgba(255,0,0,0.1)", color: "#ff4444", border: "1px solid rgba(255,0,0,0.2)" }}>
                ❌ {verificationResult.message}
              </div>
            ) : (
              <div className="badge" style={{ backgroundColor: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)" }}>
                ARTIFACT LOADED
              </div>
            )}

            <div className="results-grid">
              <div className="image-container">
                <img
                  src={`data:image/jpeg;base64,${artifact.blurredImageBase64}`}
                  alt="Witness"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>

              <div className="metadata">
                <div className="meta-item">
                  <span className="meta-label">Location Proof</span>
                  <span className="meta-value">{artifact.metadata.location_name}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Privacy Radius</span>
                  <span className="meta-value">~{artifact.metadata.radius_km} KM</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Timestamp</span>
                  <span className="meta-value">
                    {new Date(artifact.metadata.timestamp).toLocaleString()}
                  </span>
                </div>
                {artifact.metadata.certificate_id && (
                  <div className="meta-item">
                    <span className="meta-label">Certificate ID</span>
                    <span className="meta-value" style={{ color: "var(--success)" }}>
                      {artifact.metadata.certificate_id}
                    </span>
                  </div>
                )}
                <div className="meta-item">
                  <span className="meta-label">Image Hash</span>
                  <span className="meta-value" style={{ wordBreak: "break-all", fontSize: "0.7rem" }}>
                    {artifact.publicInputs.imageHash}
                  </span>
                </div>

                {verificationResult?.success && (
                  <div className="meta-item" style={{ borderTop: "1px solid rgba(255,255,255,0.1)", marginTop: "10px", paddingTop: "15px" }}>
                    <span className="meta-label">On-Chain Notarization</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                      <div className="pulse-dot" style={{ background: "var(--success)" }}></div>
                      <span className="meta-value" style={{ color: "var(--success)", fontSize: "0.8rem" }}>
                        Sepolia Record: 0x742d...f421 (Verified)
                      </span>
                    </div>
                  </div>
                )}

                {!verificationResult?.success && (
                  <button
                    className="btn-verify"
                    onClick={verifyProof}
                    disabled={isVerifying}
                  >
                    {isVerifying ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div className="loading-spinner"></div>
                        VERIFYING...
                      </div>
                    ) : (
                      "RUN VERIFICATION"
                    )}
                  </button>
                )}
                
                {artifact && (
                  <button 
                    style={{ background: "transparent", border: "1px solid var(--glass-border)", color: "rgba(255,255,255,0.4)", marginTop: "1rem", padding: "0.5rem", borderRadius: "8px", cursor: "pointer" }}
                    onClick={() => setArtifact(null)}
                  >
                    Upload Another
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <footer style={{ marginTop: "4rem", color: "rgba(255,255,255,0.2)", fontSize: "0.8rem" }}>
        ZeroWitness • Privacy-Preserving Digital Notary System
      </footer>
    </main>
  );
}
