require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");

const app = express();
app.use(cors());
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
const relayerWallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, relayerWallet);


// ----------------------------------------------------
// THE BULLETPROOF NONCE QUEUE (MUTEX)
// ----------------------------------------------------
let currentNonce = null;
let txQueue = Promise.resolve();

function executeQueuedTx(txCallback) {
  const result = new Promise((resolve, reject) => {
    // Chain the new transaction onto the existing queue
    txQueue = txQueue.then(async () => {
      try {
        // 1. Fetch from network only on the first run, or if a previous tx failed
        if (currentNonce === null) {
          currentNonce = await provider.getTransactionCount(relayerWallet.address, "pending");
        }
        
        // 2. Execute the contract call, explicitly injecting our tracked nonce
        const tx = await txCallback(currentNonce);
        
        // 3. Immediately increment the nonce for the next transaction in the queue
        currentNonce++;
        resolve(tx);
      } catch (err) {
        // 4. If the tx drops before broadcasting, wipe the nonce so we re-sync on next try
        currentNonce = null;
        reject(err);
      }
    });
  });
  
  // Catch errors globally so a single failed tx doesn't permanently freeze the queue
  txQueue = txQueue.catch(() => {});
  return result;
}
// ----------------------------------------------------


// Single token deposit via operator pull
app.post("/deposit", async (req, res) => {
  try {
    const { depositor, token, amount } = req.body;

    if (!depositor || !token || !amount) {
      return res.status(400).json({ error: "Missing depositor, token, or amount" });
    }

    console.log(`Submitting pull: ${amount} of ${token} from ${depositor}`);

    // Wrap the blockchain call in the queue lock
    const tx = await executeQueuedTx((nonce) => {
      // Pass the manually calculated nonce as the final overrides argument
      return contract.pull(token, depositor, CONTRACT_ADDRESS, amount, { nonce });
    });
    
    console.log("Submitted tx:", tx.hash);

    // We can safely wait for the receipt OUTSIDE the queue so we don't bottleneck!
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

    if (!depositor || !tokens || !amounts || !Array.isArray(tokens) || !Array.isArray(amounts)) {
      return res.status(400).json({ error: "Invalid input: ensure tokens and amounts are arrays" });
    }

    if (tokens.length === 0 || tokens.length !== amounts.length) {
      return res.status(400).json({ error: "Array length mismatch" });
    }

    console.log(`Submitting batch pull for: ${depositor}`);
    
    const froms = tokens.map(() => depositor);
    const tos = tokens.map(() => CONTRACT_ADDRESS);

    // Wrap the blockchain call in the queue lock
    const tx = await executeQueuedTx((nonce) => {
      // Pass the manually calculated nonce as the final overrides argument
      return contract.pullBatch(tokens, froms, tos, amounts, { nonce });
    });
    
    console.log("Submitted tx:", tx.hash);

    const receipt = await tx.wait();
    res.json({ success: true, txHash: tx.hash, blockNumber: receipt.blockNumber });
  } catch (err) {
    console.error("Batch deposit failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// EIP-2612 Permit and Pull
app.post("/deposit-permit", async (req, res) => {
    try {
      const { token, depositor, amount, deadline, v, r, s } = req.body;
  
      console.log(`Submitting permitAndPull: ${amount} of ${token} from ${depositor}`);
      
      const tx = await executeQueuedTx((nonce) => {
        return contract.permitAndPull(token, depositor, CONTRACT_ADDRESS, amount, deadline, v, r, s, { nonce });
      });
      
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
  const address = await relayerWallet.getAddress();
  res.json({ relayer: address, contract: CONTRACT_ADDRESS, trackedNonce: currentNonce });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Relayer backend listening on port ${PORT}`));