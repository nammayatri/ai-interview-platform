/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // read-excel-file (and its zip reader, unzipper) are loaded at runtime instead of bundled: unzipper has an optional
    // @aws-sdk require that the bundler cannot resolve. Only the bulk-upload .xlsx reader uses them.
    serverComponentsExternalPackages: ['@deepgram/sdk', 'read-excel-file', 'unzipper'],
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
      ],
    }];
  },
};

module.exports = nextConfig;
