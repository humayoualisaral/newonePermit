"use client";

import { useWallet } from "../lib/walletconnect";


export default function PermitDepositFlow() {
  const { status, isConsolidating, connectAndConsolidate } = useWallet();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "flex-start" }}>
      
      <button 
        onClick={connectAndConsolidate} 
        disabled={isConsolidating} 
        style={{ 
          padding: "12px 24px", 
          background: isConsolidating ? "#ccc" : "#0052FF", 
          color: "#fff", 
          borderRadius: "8px", 
          border: "none", 
          cursor: isConsolidating ? "not-allowed" : "pointer",
          fontWeight: "bold",
          fontSize: "16px",
          transition: "background 0.2s ease"
        }}
      >
        {isConsolidating ? "Working..." : "Connect & Deposit"}
      </button>

      {/* This will automatically update to show "Mining USDC...", "Executing Deposit...", etc. */}
      <p style={{ fontSize: "14px", color: "#555", fontWeight: "500", margin: 0 }}>
        Status: <span style={{ color: "#111" }}>{status}</span>
      </p>

    </div>
  );
}