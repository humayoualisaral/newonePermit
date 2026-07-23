import PermitDepositFlow from "../components/PermitDepositFlow";
import { WalletProvider } from "../lib/walletconnect";

export default function Home() {
  return (
    <WalletProvider>

    <main>
      <h1>Permit2 Deposit — Sepolia Test</h1>
      <PermitDepositFlow />
    </main>
    </WalletProvider>
  );
}
