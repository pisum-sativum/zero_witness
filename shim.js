// shim.js
import "react-native-get-random-values";
import { Buffer } from "buffer";
import { TextEncoder, TextDecoder } from "text-encoding";

global.Buffer = Buffer;
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

global.process = require("process");
global.process.env.NODE_ENV = __DEV__ ? "development" : "production";
global.process.browser = true;

// Mocking Node-only modules to prevent the Barretenberg/fs/promises crash
const fsMock = {
  readFileSync: () => new Uint8Array(),
  promises: {
    readFile: async () => new Uint8Array(),
  },
};

global.fs = fsMock;

// Browser Globals for bb.js / noir_js
if (typeof global.self === "undefined") global.self = global;
if (typeof global.window === "undefined") global.window = global;
if (typeof global.navigator === "undefined") {
  global.navigator = { userAgent: "react-native" };
}
if (typeof global.location === "undefined") {
  global.location = { protocol: "file:", href: "", origin: "" };
}
