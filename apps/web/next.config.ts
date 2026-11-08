import type { NextConfig } from "next";
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), "../../.env") });

const nextConfig: NextConfig = {
  // A second dev server (e.g. one without Auth0 for local testing) needs its own build folder; sharing .next corrupts both.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@tether/core"],
  serverExternalPackages: ["postgres", "googleapis", "@google/genai", "@aws-sdk/client-s3"],
  output: "standalone",
  outputFileTracingIncludes: { "/**": ["../../packages/core/agents/**"] },
  // @tether/core is ESM TypeScript with `.js` specifiers (NodeNext). Map them back to .ts for the bundler.
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return cfg;
  },
  turbopack: {
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
  },
};
export default nextConfig;
