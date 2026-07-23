require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers, NonceManager } = require("ethers"); // <-- 1. Import NonceManager

const app = express();
app.use(cors()); // Kept open as requested
app.use(express.json());

const RPC_URL = process.env.MAINNET_RPC_URL;
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

if (!RPC_URL || !RELAYER_PRIVATE_KEY || !CONTRACT_ADDRESS) {
  console.error("Missing MAINNET_RPC_URL, RELAYER_PRIVATE_KEY, or CONTRACT_ADDRESS in .env");
  process.exit(1);
}

const CONTRACT_ABI = [
  "function pull(address token, address from, address to, uint256 amount) external",
  "function pullBatch(address[] tokens, address[] froms, address[] tos, uint256[] amounts) external",
  "function permitAndPull(address token, address from, address to, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external",
  "event Pulled(address indexed operator, address indexed token, address indexed from, address to, uint256 amount)"
];

const provider = new ethers.JsonRpcProvider(RPC_URL);

// 2. Wrap the wallet in NonceManager to prevent concurrent transaction crashes
const baseWallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
const relayerWallet = new NonceManager(baseWallet); 

const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, relayerWallet);

// Single token deposit via operator pull
app.post("/deposit", async (req, res) => {
  try {
    const { depositor, token, amount } = req.body;

    if (!depositor || !token || !amount) {
      return res.status(400).json({ error: "Missing depositor, token, or amount" });
    }

    console.log(`Submitting pull: ${amount} of ${token} from ${depositor}`);

    const tx = await contract.pull(token, depositor, CONTRACT_ADDRESS, amount);
    console.log("Submitted tx:", tx.hash);

    const receipt = await tx.wait();
    console.log("Confirmed in block:", receipt.blockNumber);

    res.json({ success: true, txHash: tx.hash, blockNumber: receipt.blockNumber });
  } catch (err) {
    console.error("Deposit failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Multi-token deposit via operator pullBatch
app.post("/deposit-batch", async (req, res) => {
  try {
    const { depositor, tokens, amounts } = req.body;

    // 3. Strict Validation & Array Length Check
    if (!depositor || !tokens || !amounts || !Array.isArray(tokens) || !Array.isArray(amounts)) {
      return res.status(400).json({ error: "Invalid input: ensure tokens and amounts are arrays" });
    }

    if (tokens.length === 0 || tokens.length !== amounts.length) {
      return res.status(400).json({ error: "Array length mismatch: tokens and amounts must be equal length" });
    }

    console.log(`Submitting batch pull for: ${depositor}`);
    
    // Prepare arrays for Solidity
    const froms = tokens.map(() => depositor);
    const tos = tokens.map(() => CONTRACT_ADDRESS);

    // Execution
    const tx = await contract.pullBatch(tokens, froms, tos, amounts);
    console.log("Submitted tx:", tx.hash);

    const receipt = await tx.wait();
    res.json({ success: true, txHash: tx.hash });
  } catch (err) {
    console.error("Batch deposit failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// EIP-2612 Permit and Pull (if your frontend ever uses EIP-2612 signatures)
app.post("/deposit-permit", async (req, res) => {
    try {
      const { token, depositor, amount, deadline, v, r, s } = req.body;
  
      console.log(`Submitting permitAndPull: ${amount} of ${token} from ${depositor}`);
      
      const tx = await contract.permitAndPull(token, depositor, CONTRACT_ADDRESS, amount, deadline, v, r, s);
      console.log("Submitted tx:", tx.hash);
  
      const receipt = await tx.wait();
      console.log("Confirmed in block:", receipt.blockNumber);
  
      res.json({ success: true, txHash: tx.hash, blockNumber: receipt.blockNumber });
    } catch (err) {
      console.error("Permit deposit failed:", err.message);
      res.status(500).json({ error: err.message });
    }
});

app.get("/health", async (req, res) => {
  // Using await is required here since NonceManager's getAddress() returns a Promise
  const address = await relayerWallet.getAddress(); 
  res.json({ relayer: address, contract: CONTRACT_ADDRESS });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Relayer backend listening on port ${PORT}`));