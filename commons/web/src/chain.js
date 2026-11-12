import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const KEY_STORAGE = "commons-player-key";

async function getJson(url, options) {
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok || body.error)
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  return body;
}

export function fetchConfig(origin) {
  return getJson(`${origin}/config.json`);
}

export async function connect(origin) {
  const config = await fetchConfig(origin);
  const chain = defineChain({
    id: config.chainId,
    name: "Practice chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [`${origin}/rpc`] } },
  });
  const transport = http(`${origin}/rpc`, { batch: true });
  return {
    origin,
    chain,
    transport,
    contract: { address: config.address, abi: config.abi },
    publicClient: createPublicClient({
      chain,
      transport,
      pollingInterval: 500,
    }),
    clockOffsetMs: config.serverTime - Date.now(),
    joinUrl: config.joinUrls?.[0] ?? origin,
  };
}

export function loadAccount(storage) {
  let key = storage.getItem(KEY_STORAGE);
  if (!key) {
    key = generatePrivateKey();
    storage.setItem(KEY_STORAGE, key);
  }
  return privateKeyToAccount(key);
}

export async function connectWallet(game, account) {
  await getJson(`${game.origin}/fund`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: account.address }),
  });
  return createWalletClient({
    account,
    chain: game.chain,
    transport: game.transport,
  });
}

function reader(game) {
  return (functionName, args = []) =>
    game.publicClient.readContract({ ...game.contract, functionName, args });
}

export async function readRules(game) {
  const read = reader(game);
  const [capacity, collapseBelow, growthPercent, maxPerHarvest, roundSeconds, startTime] =
    await Promise.all([
      read("capacity"),
      read("collapseBelow"),
      read("growthPercent"),
      read("maxPerHarvest"),
      read("roundSeconds"),
      read("startTime"),
    ]);
  return { capacity, collapseBelow, growthPercent, maxPerHarvest, roundSeconds, startTime };
}

export async function readState(game, me) {
  const read = reader(game);
  const [stock, round, collapsed, [players, names, harvested]] =
    await Promise.all([
      read("stockNow"),
      read("currentRound"),
      read("collapsed"),
      read("scoreboard"),
    ]);
  const board = players
    .map((address, i) => ({ address, name: names[i], harvested: harvested[i] }))
    .sort((a, b) =>
      b.harvested > a.harvested ? 1 : b.harvested < a.harvested ? -1 : 0,
    );

  let mine = null;
  if (me) {
    const [name, total, hasHarvested, lastRound] = await Promise.all([
      read("nameOf", [me]),
      read("harvestedBy", [me]),
      read("hasHarvested", [me]),
      read("lastHarvestRound", [me]),
    ]);
    mine = {
      name,
      total,
      harvestedThisRound: hasHarvested && lastRound === round,
    };
  }
  return { stock, round, collapsed, board, mine };
}

export function harvestFeed(game) {
  const harvests = [];
  let nextBlock = 0n;
  return async function update() {
    const latest = await game.publicClient.getBlockNumber();
    if (latest >= nextBlock) {
      const logs = await game.publicClient.getContractEvents({
        ...game.contract,
        eventName: "Harvested",
        fromBlock: nextBlock,
        toBlock: latest,
      });
      for (const log of logs) harvests.push({ ...log.args });
      nextBlock = latest + 1n;
    }
    return harvests;
  };
}

export async function sendTx(game, wallet, functionName, args) {
  try {
    const { request } = await game.publicClient.simulateContract({
      ...game.contract,
      account: wallet.account,
      functionName,
      args,
    });
    const hash = await wallet.writeContract(request);
    return await game.publicClient.waitForTransactionReceipt({ hash });
  } catch (err) {
    throw new Error(reasonOf(err));
  }
}

export function reasonOf(err) {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    return revert?.reason ?? err.shortMessage;
  }
  return err?.message ?? String(err);
}
