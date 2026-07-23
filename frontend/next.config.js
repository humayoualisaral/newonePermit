/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@x402/evm': false,
      '@x402/svm': false,
      '@x402/svm/exact/client': false,
    };
    return config;
  },
};

export default nextConfig;