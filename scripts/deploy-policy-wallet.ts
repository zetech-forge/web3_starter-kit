import { mkdirSync, writeFileSync } from "node:fs";
import { network } from "hardhat";
import { parseEther } from "viem";

const WINDOW_LIMIT = parseEther("0.05");
const WINDOW_SECONDS = 3600n;
const CO_SIGN_ABOVE = parseEther("0.02");
const STARTING_BALANCE = parseEther("1");

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [owner, agent, seller] = await viem.getWalletClients();

const wallet = await viem.deployContract(
  "PolicyWallet",
  [agent.account.address, WINDOW_LIMIT, WINDOW_SECONDS, CO_SIGN_ABOVE],
  { value: STARTING_BALANCE },
);
await wallet.write.setPayee([seller.account.address, true], {
  account: owner.account,
});

const chainId = await publicClient.getChainId();
const deployment = {
  wallet: wallet.address,
  chainId,
  owner: owner.account.address,
  agent: agent.account.address,
  seller: seller.account.address,
};
mkdirSync("deployments", { recursive: true });
writeFileSync("deployments/agent.json", JSON.stringify(deployment, null, 2));

console.log("PolicyWallet deployed:", deployment);
console.log("Next: npm run data-api, then npm run agent -- \"your request\"");
