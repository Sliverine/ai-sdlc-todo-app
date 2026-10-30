import type { NextConfig } from "next";
import { resolve } from "node:path";

const config: NextConfig = {
  turbopack: { root: resolve(".") },
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "same-origin" },
      ],
    }];
  },
};

export default config;
