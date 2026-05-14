// UI and Core Components

import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ImageBackground,
  Share,
  Platform,
} from "react-native";
// Removed expo-sharing to avoid native module errors

import * as FileSystem from "expo-file-system/legacy";
import {
  Canvas,
  Image as SkiaImage,
  Blur,
  useImage,
  useCanvasRef,
} from "@shopify/react-native-skia";

import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { runProof } from "./zk";

import circuitMap from "./assets/circuit/witness_circuit.json";
import { useEffect, useRef, useState } from "react";

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [location, setLocation] = useState<Location.LocationObject | null>(
    null,
  );
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [imageHash, setImageHash] = useState<string | null>(null);
  const [isProving, setIsProving] = useState(false);
  const [verified, setVerified] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [proofData, setProofData] = useState<any>(null);
  const [blurredBase64ForArtifact, setBlurredBase64ForArtifact] = useState<string | null>(null);

  const skiaImage = useImage(capturedUri);

  const cameraRef = useRef<any>(null);
  const locationSubscription = useRef<Location.LocationSubscription | null>(
    null,
  );
  const locationPoller = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useCanvasRef();

  // --- Animation Values ---
  const scannerPos = useSharedValue(0);

  useEffect(() => {
    scannerPos.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2500 }),
        withTiming(0, { duration: 2500 }),
      ),
      -1,
    );
  }, []);

  // --- Real-time GPS Sync ---
  useEffect(() => {
    let isMounted = true;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });
      if (isMounted) {
        setLocation(loc);
      }

      locationSubscription.current?.remove();
      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Highest,
          timeInterval: 1000,
          distanceInterval: 1,
          mayShowUserSettingsDialog: true,
        },
        (update) => {
          if (isMounted) {
            setLocation(update);
          }
        },
      );

      if (locationPoller.current) {
        clearInterval(locationPoller.current);
      }
      locationPoller.current = setInterval(() => {
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Highest,
        })
          .then((update) => {
            if (isMounted) {
              setLocation(update);
            }
          })
          .catch(() => {});
      }, 4000);
    })();

    return () => {
      isMounted = false;
      locationSubscription.current?.remove();
      locationSubscription.current = null;
      if (locationPoller.current) {
        clearInterval(locationPoller.current);
        locationPoller.current = null;
      }
    };
  }, []);

  const takePhoto = async () => {
    if (cameraRef.current) {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.5,
        skipProcessing: true,
      });
      setCapturedUri(photo.uri);
    }
  };

  const generateZKProof = async () => {
    if (!location || !capturedUri) {
      return Alert.alert("Wait", "Capture a photo and wait for GPS lock.");
    }

    const imageSnapshot = canvasRef.current?.makeImageSnapshot();
    if (!imageSnapshot) {
      return Alert.alert("Error", "Could not capture blurred image snapshot.");
    }

    const blurredBase64 = imageSnapshot.encodeToBase64();
    const blurredUri = FileSystem.cacheDirectory + 'blurred_' + Date.now() + '.jpg';
    
    setIsProving(true);
    setProcessingStatus("Preparing privacy-preserving image...");

    try {
      await FileSystem.writeAsStringAsync(blurredUri, blurredBase64, { encoding: FileSystem.EncodingType.Base64 });
      setProcessingStatus("Uploading image and generating proof...");

      const result = await runProof(circuitMap as any, {
        imageUri: blurredUri,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
      setImageHash(result.imageHash);
      setProofData(result);
      setVerified(true);
      setBlurredBase64ForArtifact(blurredBase64);
      setProcessingStatus("Proof Verified Successfully!");
      Alert.alert("Success", "ZK-Proof Generated for Live Coordinates!");
    } catch (e) {
      console.error(e);
      const message =
        e instanceof Error
          ? e.message
          : "Proof generation failed. Check your circuit logic.";
      Alert.alert("Error", message);
    } finally {
      setIsProving(false);
      setProcessingStatus("");
    }
  };

  const exportWitness = async () => {
    if (!proofData || !capturedUri || !location) return;

    try {
      setProcessingStatus("RESOLVING LOCATION...");
      const [address] = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
      const locationName = address 
        ? `${address.city || address.region || "Unknown City"}, ${address.region || address.country || "Unknown Region"}`
        : `Authenticated Region (${location.coords.latitude.toFixed(2)}, ${location.coords.longitude.toFixed(2)})`;

      setProcessingStatus("PREPARING ARTIFACT...");
      
      // Scale coordinates for public inputs as per project requirements
      const lat = Math.floor(location.coords.latitude * 10000);
      const lon = Math.floor(location.coords.longitude * 10000);

      const artifact = {
        version: "1.0.0",
        metadata: {
          timestamp: new Date().toISOString(),
          location_name: locationName,
          radius_km: 5,
          certificate_id: `WITNESS-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
        },
        proof: proofData.proof,
        publicInputs: {
          imageHash: proofData.imageHash,
          min_lat: (lat - 450).toString(),
          max_lat: (lat + 450).toString(),
          min_long: (lon - 450).toString(),
          max_long: (lon + 450).toString(),
        },
        publicInputsArray: proofData.publicInputs,
        blurredImageBase64: blurredBase64ForArtifact,
      };

      const jsonString = JSON.stringify(artifact, null, 2);

      if (Platform.OS === 'android') {
        try {
          const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
          if (permissions.granted) {
            const fileName = `witness_${Date.now()}.witness`;
            const uri = await FileSystem.StorageAccessFramework.createFileAsync(
              permissions.directoryUri, 
              fileName, 
              'application/json'
            );
            await FileSystem.writeAsStringAsync(uri, jsonString);
            Alert.alert("Artifact Saved", `Successfully saved to your chosen folder. Transfer this file to your computer to verify.`);
            return;
          }
        } catch (safError) {
          console.error("SAF Error:", safError);
          // Fall back to old behavior if SAF fails
        }
      }

      // Fallback for iOS or if SAF was cancelled/failed
      const path = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory}witness_${Date.now()}.witness`;
      await FileSystem.writeAsStringAsync(path, jsonString);

      try {
        await Share.share({
          message: `ZeroWitness Artifact Generated.\nLocation: ${locationName}\nTimestamp: ${artifact.metadata.timestamp}`,
          url: path, 
          title: "Export Witness Artifact",
        });
      } catch (shareError) {
        Alert.alert("Artifact Saved", `Your witness artifact has been saved internally to: ${path}`);
      }

      // Enforce Privacy: Delete the raw, unblurred capture from the device
      if (capturedUri) {
        await FileSystem.deleteAsync(capturedUri, { idempotent: true });
      }

    } catch (e) {
      console.error(e);
      Alert.alert("Export Failed", "Could not create witness artifact.");
    } finally {
      setProcessingStatus("");
    }
  };

  const scannerStyle = useAnimatedStyle(() => ({
    top: `${scannerPos.value * 100}%`,
  }));

  const statusText = isProving
    ? processingStatus || "GENERATING PROOF..."
    : processingStatus ||
      (!location ? "WAITING FOR GPS..." : "READY TO GENERATE PROOF");

  const canGenerate = Boolean(capturedUri && location && !isProving);

  if (!permission?.granted) {
    return (
      <View style={styles.center}>
        <Ionicons name="camera-outline" size={64} color="#4A90E2" />
        <Text style={styles.permissionText}>Camera Access Required</Text>
        <TouchableOpacity onPress={requestPermission} style={styles.btnPri}>
          <Text style={styles.btnTextWhite}>ENABLE ACCESS</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!capturedUri ? (
        <View style={styles.full}>
          <CameraView style={styles.full} ref={cameraRef}>
            <View style={styles.scannerContainer}>
              <Animated.View style={[styles.scannerLine, scannerStyle]} />
            </View>

            <View style={styles.header}>
              <View style={styles.statusBadge}>
                <View style={styles.pulseDot} />
                <Text style={styles.headerText}>
                  {location
                    ? `SYSTEM ONLINE: ${location.coords.latitude.toFixed(4)}, ${location.coords.longitude.toFixed(4)}`
                    : "SCANNING FOR GPS..."}
                </Text>
              </View>
            </View>

            <TouchableOpacity onPress={takePhoto} style={styles.snapContainer}>
              <View style={styles.snapOuter}>
                <View style={styles.snapInner} />
              </View>
            </TouchableOpacity>
          </CameraView>
        </View>
      ) : (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.full}>
          {skiaImage ? (
            <Canvas style={styles.full} ref={canvasRef}>
              <SkiaImage
                image={skiaImage}
                x={0}
                y={0}
                width={400} // Approximate screen width
                height={800} // Approximate screen height
                fit="cover"
              >
                <Blur blur={35} />
              </SkiaImage>
            </Canvas>
          ) : (
            <View style={[styles.full, { backgroundColor: "#111" }]} />
          )}
          <View style={styles.captureShade} />

          <View style={styles.overlay}>
            <Text style={styles.brand}>ZERO WITNESS</Text>
            <Text style={styles.captureLocation}>
              {location
                ? `${location.coords.latitude.toFixed(5)}, ${location.coords.longitude.toFixed(5)}`
                : "GPS LOCKING..."}
            </Text>
            <View style={styles.divider} />

            {verified ? (
              <Animated.View entering={FadeIn} style={styles.verifiedBox}>
                <Ionicons name="checkmark-circle" size={32} color="#00FF00" />
                <Text style={styles.verifiedText}>ZK-PROOF VALIDATED</Text>
                <View style={styles.reportItem}>
                  <Text style={styles.reportLabel}>LOCATION RADIUS:</Text>
                  <Text style={styles.reportValue}>~1.0 KM (PROTECTED)</Text>
                </View>
                <View style={styles.reportItem}>
                  <Text style={styles.reportLabel}>IMAGE HASH:</Text>
                  <Text style={styles.reportValue} numberOfLines={1}>
                    {imageHash?.substring(0, 32)}...
                  </Text>
                </View>
              </Animated.View>
            ) : (
              <View style={styles.unverifiedBox}>
                <Text style={styles.unverifiedText}>{statusText}</Text>
                {isProving && (
                  <ActivityIndicator
                    color="#4A90E2"
                    style={{ marginTop: 10 }}
                  />
                )}
              </View>
            )}
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              onPress={async () => {
                if (capturedUri) {
                  await FileSystem.deleteAsync(capturedUri, { idempotent: true });
                }
                setCapturedUri(null);
                setVerified(false);
                setImageHash(null);
                setProcessingStatus("");
                setBlurredBase64ForArtifact(null);
              }}
              style={styles.btnSec}
              disabled={isProving}
            >
              <Ionicons
                name="refresh-outline"
                size={20}
                color="#fff"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.btnText}>RETAKE</Text>
            </TouchableOpacity>

            {verified && (
              <TouchableOpacity
                onPress={exportWitness}
                style={[styles.btnSec, { borderColor: "#00FF00" }]}
                disabled={isProving}
              >
                <Ionicons
                  name="share-outline"
                  size={20}
                  color="#00FF00"
                  style={{ marginRight: 8 }}
                />
                <Text style={[styles.btnText, { color: "#00FF00" }]}>
                  EXPORT WITNESS
                </Text>
              </TouchableOpacity>
            )}

            {!verified && (
              <TouchableOpacity
                onPress={generateZKProof}
                style={styles.btnPri}
                disabled={!canGenerate}
              >
                {isProving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons
                      name="shield-checkmark-outline"
                      size={20}
                      color="#fff"
                      style={{ marginRight: 8 }}
                    />
                    <Text style={styles.btnTextWhite}>GENERATE PROOF</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
    padding: 20,
  },
  full: { flex: 1 },
  header: {
    position: "absolute",
    top: 60,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(0,255,0,0.3)",
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#00FF00",
    marginRight: 8,
    shadowColor: "#00FF00",
    shadowRadius: 4,
    shadowOpacity: 1,
  },
  headerText: {
    color: "#00FF00",
    fontWeight: "bold",
    fontSize: 12,
    letterSpacing: 1.5,
    fontFamily: "monospace",
  },
  scannerContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  scannerLine: {
    width: "100%",
    height: 2,
    backgroundColor: "#4A90E2",
    shadowColor: "#4A90E2",
    shadowRadius: 10,
    shadowOpacity: 1,
    zIndex: 5,
  },
  snapContainer: {
    position: "absolute",
    bottom: 50,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  snapOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: "#4A90E2",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  snapInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#fff",
  },
  overlay: {
    position: "absolute",
    top: 100,
    width: "100%",
    alignItems: "center",
    paddingHorizontal: 30,
  },
  captureShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  brand: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: 4,
    marginBottom: 10,
  },
  captureLocation: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    fontWeight: "bold",
    letterSpacing: 1,
    marginBottom: 8,
  },
  divider: {
    width: 40,
    height: 4,
    backgroundColor: "#4A90E2",
    marginBottom: 30,
  },
  verifiedBox: {
    backgroundColor: "rgba(0,255,0,0.1)",
    padding: 24,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(0,255,0,0.4)",
    width: "100%",
    alignItems: "center",
  },
  verifiedText: {
    color: "#00FF00",
    fontWeight: "900",
    fontSize: 18,
    marginTop: 12,
    marginBottom: 20,
    letterSpacing: 2,
  },
  reportItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    marginBottom: 10,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  reportLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    fontWeight: "bold",
  },
  reportValue: {
    color: "#fff",
    fontSize: 10,
    fontFamily: "monospace",
  },
  unverifiedBox: {
    alignItems: "center",
    padding: 20,
  },
  unverifiedText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    fontWeight: "bold",
    letterSpacing: 1,
    textAlign: "center",
  },
  footer: {
    position: "absolute",
    bottom: 60,
    flexDirection: "row",
    width: "100%",
    justifyContent: "center",
    gap: 15,
  },
  btnPri: {
    backgroundColor: "#4A90E2",
    flexDirection: "row",
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
    shadowColor: "#4A90E2",
    shadowRadius: 15,
    shadowOpacity: 0.5,
  },
  btnSec: {
    backgroundColor: "rgba(255,255,255,0.1)",
    flexDirection: "row",
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  btnText: { fontWeight: "bold", color: "#fff", letterSpacing: 1 },
  btnTextWhite: { fontWeight: "bold", color: "#fff", letterSpacing: 1 },
  permissionText: {
    color: "#fff",
    fontSize: 18,
    marginVertical: 20,
    textAlign: "center",
  },
});
