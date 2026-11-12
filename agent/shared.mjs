import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

export const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const KIT = fileURLToPath(new URL("..", import.meta.url));
const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";

function readJson(...parts) {
  const path = join(KIT, ...parts);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Missing ${path}. Run: npm run deploy:agent`);
  }
}

export function loadWallet() {
  const deployment = readJson("deployments", "agent.json");
  const { abi } = readJson("artifacts", "contracts", "PolicyWallet.sol", "PolicyWallet.json");
  const chain = defineChain({
    id: deployment.chainId,
    name: "Practice chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL), pollingInterval: 250 });
  return { deployment, chain, publicClient, contract: { address: deployment.wallet, abi } };
}

export function accountFor(role, envKey, index) {
  const key = process.env[envKey];
  if (!key && !new Set(["127.0.0.1", "localhost", "[::1]"]).has(new URL(RPC_URL).hostname)) {
    throw new Error("Default Hardhat accounts are for local practice chains only; use a local RPC_URL");
  }
  const account = key ? privateKeyToAccount(key) : mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: index });
  return { role, account };
}

export function walletClientFor(wallet, account) {
  return createWalletClient({ account, chain: wallet.chain, transport: http(RPC_URL) });
}

export async function write(wallet, account, functionName, args) {
  try {
    const { request, result } = await wallet.publicClient.simulateContract({
      ...wallet.contract,
      account,
      functionName,
      args,
    });
    const hash = await walletClientFor(wallet, account).writeContract(request);
    await wallet.publicClient.waitForTransactionReceipt({ hash });
    return { ok: true, txHash: hash, result };
  } catch (err) {
    return { ok: false, error: reasonOf(err) };
  }
}

export function reasonOf(err) {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    return revert?.reason ?? err.shortMessage;
  }
  return err?.message ?? String(err);
}
