import { formatEther, isAddress, parseEther } from "viem";
import { accountFor, loadWallet, reasonOf, write } from "./shared.mjs";

const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "http://localhost:11434/v1";
const LLM_MODEL = process.env.LLM_MODEL ?? "qwen2.5:3b";
const LLM_API_KEY = process.env.LLM_API_KEY ?? "";
const FAKE_LLM = process.env.LLM_FAKE === "1";
const DATA_API_URL = process.env.DATA_API_URL ?? "http://localhost:4021";
const MAX_STEPS = 6;

const SYSTEM_PROMPT = `You are a purchasing agent for Wanjiru, a smallholder farmer in Kiambu County, Kenya.
You can buy weather forecasts and crop market prices for her, and pay her suppliers from her policy wallet.
Use the tools to act. Amounts are in ETH on a practice chain. Keep your final answer short and practical.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "check_wallet",
      description: "Show the policy wallet's balance and spending rules.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "buy_data",
      description: "Buy data from the paid data API. Pays automatically from the policy wallet.",
      parameters: {
        type: "object",
        properties: {
          dataset: { type: "string", enum: ["weather", "market-prices"] },
          query: { type: "string", description: "A place for weather, or a crop for market prices." },
        },
        required: ["dataset", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pay",
      description: "Pay someone from the policy wallet.",
      parameters: {
        type: "object",
        properties: {
          payee: { type: "string", description: "0x address" },
          amount_eth: { type: "string" },
          reason: { type: "string" },
        },
        required: ["payee", "amount_eth", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_owner_approval",
      description: "Ask the owner to co-sign a payment that is too large for the agent to make alone.",
      parameters: {
        type: "object",
        properties: {
          payee: { type: "string" },
          amount_eth: { type: "string" },
          reason: { type: "string" },
        },
        required: ["payee", "amount_eth", "reason"],
      },
    },
  },
];

const wallet = loadWallet();
const { account: agent } = accountFor("agent", "AGENT_PRIVATE_KEY", 1);

async function checkWallet() {
  const read = (functionName) => wallet.publicClient.readContract({ ...wallet.contract, functionName });
  const [balance, spent, limit, coSignAbove, paused] = await Promise.all([
    wallet.publicClient.getBalance({ address: wallet.contract.address }),
    read("spentInWindow"),
    read("windowLimit"),
    read("coSignAbove"),
    read("paused"),
  ]);
  return {
    balanceEth: formatEther(balance),
    spentThisWindowEth: formatEther(spent),
    windowLimitEth: formatEther(limit),
    coSignAboveEth: formatEther(coSignAbove),
    paused,
  };
}

function parsePayment({ payee, amount_eth }) {
  if (!isAddress(payee ?? "")) throw new Error(`${payee} is not an address`);
  return [payee, parseEther(String(amount_eth))];
}

async function pay(args) {
  const [payee, amount] = parsePayment(args);
  return write(wallet, agent, "pay", [payee, amount, String(args.reason ?? "")]);
}

async function requestApproval(args) {
  const [payee, amount] = parsePayment(args);
  const sent = await write(wallet, agent, "requestPayment", [payee, amount, String(args.reason ?? "")]);
  return sent.ok ? { ok: true, requestId: String(sent.result), note: "Waiting for the owner to approve" } : sent;
}

async function buyData({ dataset, query }) {
  const url = `${DATA_API_URL}/${encodeURIComponent(dataset)}?q=${encodeURIComponent(query)}`;
  const first = await fetch(url);
  if (first.status !== 402) return first.json();
  const { accepts } = await first.json();
  const payment = await write(wallet, agent, "pay", [
    accepts.payTo,
    BigInt(accepts.amountWei),
    accepts.memo,
  ]);
  if (!payment.ok) return { error: `Could not pay for the data: ${payment.error}` };
  const signature = await agent.signMessage({ message: payment.txHash });
  const second = await fetch(url, {
    headers: { "x-payment": payment.txHash, "x-payment-signature": signature },
  });
  return second.json();
}

async function runTool(name, args) {
  try {
    if (name === "check_wallet") return await checkWallet();
    if (name === "buy_data") return await buyData(args);
    if (name === "pay") return await pay(args);
    if (name === "request_owner_approval") return await requestApproval(args);
    return { error: `Unknown tool ${name}` };
  } catch (err) {
    return { error: reasonOf(err) };
  }
}

function toolCall(name, args) {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id: `call_${Date.now()}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  };
}

function fakeLlm(messages) {
  const last = messages.at(-1);
  if (last.role === "tool") return { role: "assistant", content: `Done. ${last.content}` };
  const text = last.content;
  const payee = text.match(/0x[0-9a-fA-F]{40}/)?.[0];
  const amount = text.match(/(\d+(?:\.\d+)?)\s*eth/i)?.[1];
  if (payee && amount) return toolCall("pay", { payee, amount_eth: amount, reason: text.slice(0, 80) });
  if (/price|market|sell/i.test(text)) return toolCall("buy_data", { dataset: "market-prices", query: "maize" });
  if (/wallet|balance|limit/i.test(text)) return toolCall("check_wallet", {});
  return toolCall("buy_data", { dataset: "weather", query: "Kiambu" });
}

async function callLlm(messages) {
  if (FAKE_LLM) return fakeLlm(messages);
  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(LLM_API_KEY ? { authorization: `Bearer ${LLM_API_KEY}` } : {}),
    },
    body: JSON.stringify({ model: LLM_MODEL, messages, tools: TOOLS, tool_choice: "auto" }),
  });
  if (!res.ok) throw new Error(`LLM request failed (${res.status}): ${await res.text()}`);
  const { role, content, tool_calls } = (await res.json()).choices[0].message;
  return { role, content: content ?? null, ...(tool_calls?.length ? { tool_calls } : {}) };
}

async function main() {
  const request = process.argv.slice(2).join(" ").trim();
  if (!request) {
    console.log('Usage: npm run agent -- "What will the weather be in Kiambu this week?"');
    process.exit(1);
  }
  if (agent.address.toLowerCase() !== wallet.deployment.agent.toLowerCase()) {
    throw new Error(`This key (${agent.address}) is not the wallet's agent (${wallet.deployment.agent})`);
  }
  console.log(`Agent ${agent.address} using ${FAKE_LLM ? "the fake LLM" : `${LLM_MODEL} at ${LLM_BASE_URL}`}`);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: request },
  ];
  for (let step = 0; step < MAX_STEPS; step++) {
    const reply = await callLlm(messages);
    messages.push(reply);
    if (!reply.tool_calls) {
      console.log(`\nAgent: ${reply.content || "(the model gave no answer)"}`);
      return;
    }
    for (const call of reply.tool_calls) {
      const args = JSON.parse(call.function.arguments || "{}");
      console.log(`\n> ${call.function.name} ${JSON.stringify(args)}`);
      const result = await runTool(call.function.name, args);
      console.log(`< ${JSON.stringify(result)}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  console.log(`\nAgent stopped after ${MAX_STEPS} steps.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
