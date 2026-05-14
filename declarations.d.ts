// declarations.d.ts
declare module "*.json";
declare module "@noir-lang/backend_barretenberg";
declare module "@noir-lang/noir_js";
declare module "@shopify/react-native-skia";
declare module "./shim";

declare var Buffer: any;
declare var TextEncoder: any;
declare var TextDecoder: any;

// This line specifically helps with React resolution issues
import * as React from 'react';
export default React;