import type { NextConfig } from "next";

// demo/run.ts builds the live demo into a folder of its own, so it can run beside the replay demo.
const nextConfig: NextConfig = { distDir: process.env.NEXT_DIST_DIR || ".next" };

export default nextConfig;
