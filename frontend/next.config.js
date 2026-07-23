/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // 1. Ignore missing experimental Wagmi wallet packages
    config.resolve.alias = {
      ...config.resolve.alias,
      
      // Coinbase Smart Wallet
      '@x402/evm': false,
      '@x402/svm': false,
      '@x402/svm/exact/client': false,
      
      // Paradigm Porto Wallet
      'porto': false,
      'porto/internal': false,
      
      // Tempo Wallet / Accounts API (The current error)
      'accounts': false,
      
      // Common WalletConnect / Web3 noisy backend dependencies
      'pino-pretty': false,
      'lokijs': false,
      'encoding': false,
      'utf-8-validate': false,
      'bufferutil': false,
    };

    // 2. Ignore Node.js native modules that shouldn't bundle in the browser
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
    };

    return config;
  },
};

module.exports = nextConfig;
// (If your file is next.config.mjs, use `export default nextConfig;` instead of module.exports)