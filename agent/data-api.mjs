import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { formatEther, parseEther, parseEventLogs, verifyMessage } from "viem";
import { loadWallet } from "./shared.mjs";

const PORT = Number(process.env.DATA_API_PORT ?? 4021);
const PRICE = parseEther(process.env.DATA_PRICE_ETH ?? "0.001");

const wallet = loadWallet();
const seller = wallet.deployment.seller;
const usedPayments = new Set();
const startBlock = await wallet.publicClient.getBlockNumber();

function seeded(text, i) {
  return createHash("sha256").update(`${text}:${i}`).digest().readUInt32BE(0);
}

const DATASETS = {
  weather: (place) => ({
    place,
    forecast: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => ({
      day,
      rainMm: seeded(place, i) % 25,
      highC: 20 + (seeded(place, i + 7) % 10),
    })),
  }),
  "market-prices": (crop) => ({
    crop,
    unit: "KES per kg",
    markets: ["Nairobi", "Thika", "Nakuru"].map((market, i) => ({
      market,
      price: 30 + (seeded(crop, i) % 90),
    })),
  }),
};

async function checkPayment(hash, memo, signature) {
  let receipt;
  try {
    receipt = await wallet.publicClient.getTransactionReceipt({ hash });
  } catch {
    return "Payment transaction not found";
  }
  if (receipt.status !== "success") return "Payment transaction failed";
  if (receipt.blockNumber < startBlock) return "That payment was made before this server started";
  const signedByPayer = await verifyMessage({ address: receipt.from, message: hash, signature }).catch(() => false);
  if (!signedByPayer) return "X-PAYMENT-SIGNATURE must be the payer's signature of the transaction hash";
  const paid = parseEventLogs({ abi: wallet.contract.abi, eventName: "Paid", logs: receipt.logs }).find(
    (log) =>
      log.address.toLowerCase() === wallet.contract.address.toLowerCase() &&
      log.args.payee.toLowerCase() === seller.toLowerCase() &&
      log.args.amount >= PRICE &&
      log.args.reason === memo,
  );
  return paid ? null : `No payment of ${formatEther(PRICE)} ETH to ${seller} with reason "${memo}" in that transaction`;
}

async function verifyPayment(txHash, memo, signature) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return "That is not a transaction hash";
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return "Send X-PAYMENT-SIGNATURE with the payer's signature";
  const key = txHash.toLowerCase();
  if (usedPayments.has(key)) return "That payment was already used";
  usedPayments.add(key);
  const problem = await checkPayment(txHash, memo, signature);
  if (problem) usedPayments.delete(key);
  return problem;
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const dataset = DATASETS[url.pathname.slice(1)];
  if (req.method !== "GET" || !dataset) {
    return send(res, 404, { error: "Try GET /weather?q=Kiambu or GET /market-prices?q=maize" });
  }
  const query = (url.searchParams.get("q") ?? "").slice(0, 40) || "Kiambu";
  const memo = `${url.pathname.slice(1)}: ${query}`;
  const payment = req.headers["x-payment"];
  if (!payment) {
    return send(res, 402, {
      error: "Payment required",
      accepts: {
        payTo: seller,
        amountWei: PRICE.toString(),
        amountEth: formatEther(PRICE),
        chainId: wallet.deployment.chainId,
        memo,
        howToPay:
          "Pay payTo from your PolicyWallet with memo as the reason, then retry with X-PAYMENT: <transaction hash> and X-PAYMENT-SIGNATURE: <the payer's signature of that hash>",
      },
    });
  }
  const problem = await verifyPayment(String(payment), memo, String(req.headers["x-payment-signature"] ?? ""));
  if (problem) return send(res, 402, { error: problem });
  send(res, 200, { mock: true, data: dataset(query) });
});

server.listen(PORT, () => {
  console.log(`Mock paid data API on http://localhost:${PORT}`);
  console.log(`Price: ${formatEther(PRICE)} ETH per request, paid to ${seller}`);
});
