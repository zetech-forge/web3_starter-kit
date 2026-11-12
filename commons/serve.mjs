import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseEther, parseTransaction, toHex } from "viem";
import { renderUnicodeCompact } from "uqr";

const PORT = Number(process.env.PORT ?? 3000);
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const KIT = fileURLToPath(new URL("..", import.meta.url));
const WEB = join(KIT, "commons", "web");
const FUND_AMOUNT = parseEther("10");
const PLAYERS_PER_DEVICE = 3;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const fundedByDevice = new Map();

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/game.bundle.js": ["game.bundle.js", "text/javascript; charset=utf-8"],
};

const ALLOWED_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_sendRawTransaction",
  "net_version",
  "web3_clientVersion",
]);

const rpcClient = createPublicClient({ transport: http(RPC_URL) });

async function loadConfig() {
  let deployment;
  try {
    deployment = JSON.parse(await readFile(join(KIT, "deployments", "commons.json"), "utf8"));
  } catch {
    throw new Error("No game deployed yet. Run: npm run deploy:commons");
  }
  const artifact = JSON.parse(
    await readFile(join(KIT, "artifacts", "contracts", "Commons.sol", "Commons.json"), "utf8"),
  );
  return { ...deployment, abi: artifact.abi, serverTime: Date.now(), joinUrls: lanUrls() };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function whyBlocked(call, gameAddress) {
  if (!ALLOWED_METHODS.has(call?.method)) return `${call?.method} is not allowed through the game server`;
  if (call.method !== "eth_sendRawTransaction") return null;
  try {
    const tx = parseTransaction(call.params?.[0]);
    if (tx.to?.toLowerCase() === gameAddress && !tx.value) return null;
  } catch {
    return "That is not a signed transaction";
  }
  return "The game server only sends transactions to the game contract";
}

async function proxyRpc(body) {
  const parsed = JSON.parse(body);
  const isBatch = Array.isArray(parsed);
  const calls = isBatch ? parsed : [parsed];
  const gameAddress = (await loadConfig()).address.toLowerCase();
  const reasons = calls.map((call) => whyBlocked(call, gameAddress));
  const allowed = calls.filter((_, i) => !reasons[i]);

  const replies = new Map();
  if (allowed.length > 0) {
    const upstream = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(allowed),
    });
    for (const reply of await upstream.json()) replies.set(reply.id, reply);
  }
  const answers = calls.map((call, i) =>
    reasons[i]
      ? { jsonrpc: "2.0", id: call?.id ?? null, error: { code: -32601, message: reasons[i] } }
      : replies.get(call.id),
  );
  return JSON.stringify(isBatch ? answers : answers[0]);
}

async function fund(body, device) {
  const { address } = JSON.parse(body);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) throw new Error("That is not an address");
  if (!LOOPBACK.has(device)) {
    const funded = fundedByDevice.get(device) ?? new Set();
    const key = address.toLowerCase();
    if (!funded.has(key) && funded.size >= PLAYERS_PER_DEVICE) {
      throw new Error("This device already has the most players allowed");
    }
    funded.add(key);
    fundedByDevice.set(device, funded);
  }
  const balance = await rpcClient.getBalance({ address });
  if (balance < FUND_AMOUNT / 10n) {
    await rpcClient.request({ method: "hardhat_setBalance", params: [address, toHex(FUND_AMOUNT)] });
  }
  return { ok: true };
}

async function mineAtRoundBoundary() {
  let config;
  try {
    config = await loadConfig();
  } catch {
    return;
  }
  const contract = { address: config.address, abi: config.abi };
  const [startTime, roundSeconds, block] = await Promise.all([
    rpcClient.readContract({ ...contract, functionName: "startTime" }),
    rpcClient.readContract({ ...contract, functionName: "roundSeconds" }),
    rpcClient.getBlock(),
  ]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const roundOf = (t) => (t - startTime) / roundSeconds;
  if (now > block.timestamp && roundOf(now) > roundOf(block.timestamp)) {
    await rpcClient.request({ method: "evm_mine", params: [] });
  }
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    if (req.method === "POST" && pathname === "/rpc") {
      return send(res, 200, await proxyRpc(await readBody(req)));
    }
    if (req.method === "POST" && pathname === "/fund") {
      return send(res, 200, await fund(await readBody(req), req.socket.remoteAddress));
    }
    if (req.method === "GET" && pathname === "/config.json") {
      return send(res, 200, await loadConfig());
    }
    if (req.method === "GET" && STATIC[pathname]) {
      const [file, type] = STATIC[pathname];
      return send(res, 200, await readFile(join(WEB, file), "utf8"), type);
    }
    send(res, 404, { error: "Not found" });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

function lanUrls() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((net) => net && net.family === "IPv4" && !net.internal)
    .map((net) => `http://${net.address}:${PORT}`);
}

server.listen(PORT, "0.0.0.0", () => {
  const urls = lanUrls();
  console.log(`Game server running. On this laptop: http://localhost:${PORT}`);
  console.log(`Big screen view: http://localhost:${PORT}/?host`);
  for (const url of urls) console.log(`Players join at: ${url}`);
  if (urls[0]) console.log(renderUnicodeCompact(urls[0]));
});

setInterval(() => mineAtRoundBoundary().catch(() => {}), 1000);
