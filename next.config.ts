import type { NextConfig } from "next";
const config: NextConfig = {
  outputFileTracingIncludes: {
    "/api/chat": ["./data/vector-index.json"],
    "/api/health": ["./data/vector-index.json"],
  },
};
export default config;
