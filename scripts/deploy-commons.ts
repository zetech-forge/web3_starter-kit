import { mkdirSync, writeFileSync } from "node:fs";
import { network } from "hardhat";

const CAPACITY = 1000n;
const COLLAPSE_BELOW = 100n;
const GROWTH_PERCENT = 50n;
const ROUND_SECONDS = BigInt(process.env.ROUND_SECONDS ?? 30);
const MAX_PER_HARVEST = 50n;

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();

const commons = await viem.deployContract("Commons", [
  CAPACITY,
  COLLAPSE_BELOW,
  GROWTH_PERCENT,
  ROUND_SECONDS,
  MAX_PER_HARVEST,
]);

const chainId = await publicClient.getChainId();
mkdirSync("deployments", { recursive: true });
writeFileSync(
  "deployments/commons.json",
  JSON.stringify({ address: commons.address, chainId }, null, 2),
);

console.log(`Commons deployed at ${commons.address} on chain ${chainId}`);
console.log("Start the game server with: npm run game");
