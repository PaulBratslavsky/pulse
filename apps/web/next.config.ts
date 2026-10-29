import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pulse renders plain <img> tags and never uses next/image. Turning the
  // optimizer off closes /_next/image, which the auth proxy leaves public.
  images: { unoptimized: true },
};

export default nextConfig;
