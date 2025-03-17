/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', 'mammoth'],
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: '/api/:path*',
      },
      {
        source: '/documents/:path*',
        destination: '/api/documents/:path*',
      },
    ];
  },
  // Set specific regions for serverless functions to ensure compatibility
  regions: ['iad1'],
  // Add webpack configuration to handle OpenAI package correctly
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Ensure OpenAI package is bundled correctly
      config.externals = [...config.externals, 'openai'];
    }
    
    return config;
  },
};

export default nextConfig;
