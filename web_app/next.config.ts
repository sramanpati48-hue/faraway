import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/file-case", destination: "/cases", permanent: true },
      { source: "/lawyers", destination: "/find-help", permanent: true },
      { source: "/resources", destination: "/legal-rights", permanent: true },
    ];
  },
  // Pin workspace root to web_app so Turbopack doesn't walk up to ~/package-lock.json
  turbopack: {
    root: appRoot,
    resolveAlias: {
      "maplibre-gl/dist/maplibre-gl.css": path.join(
        appRoot,
        "node_modules/maplibre-gl/dist/maplibre-gl.css"
      ),
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'ui-avatars.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
