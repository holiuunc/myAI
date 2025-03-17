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
  // Add webpack configuration for proper bundling in serverless environment
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Make sure openai is NOT in externals so it gets bundled properly
      // This ensures the package is available in the Vercel serverless environment
      const externalsList = [...config.externals];
      
      // Filter out 'openai' if it exists in the externals list
      config.externals = externalsList.filter(external => {
        // External can be a string, regex, function, or object
        if (typeof external === 'string') return external !== 'openai';
        if (external instanceof RegExp) return true;
        if (typeof external === 'function') {
          // Wrap the function to skip externalizing openai
          return (ctx, req, cb) => {
            if (req === 'openai') return cb();
            return external(ctx, req, cb);
          };
        }
        return true;
      });
    }
    
    return config;
  },
};

export default nextConfig;
