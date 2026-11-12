import { isAddress, zeroAddress } from "viem";
import { accountFor, loadWallet, write } from "./shared.mjs";

const USAGE = `Usage: npm run owner -- <command>
  approve <requestId>   co-sign a large payment the agent asked for
  allow <address>       add a payee to the allowlist
  block <address>       remove a payee from the allowlist
  pause | unpause       stop or restart the agent
  revoke                take the agent's key away
  agent <address>       give a new key the agent role`;

const wallet = loadWallet();
const { account: owner } = accountFor("owner", "OWNER_PRIVATE_KEY", 0);

function needAddress(value) {
  if (!isAddress(value ?? "")) throw new Error(`${value} is not an address`);
  return value;
}

const COMMANDS = {
  approve: (id) => ["approve", [BigInt(id)]],
  allow: (address) => ["setPayee", [needAddress(address), true]],
  block: (address) => ["setPayee", [needAddress(address), false]],
  pause: () => ["setPaused", [true]],
  unpause: () => ["setPaused", [false]],
  revoke: () => ["setAgent", [zeroAddress]],
  agent: (address) => ["setAgent", [needAddress(address)]],
};

const [command, arg] = process.argv.slice(2);
if (!COMMANDS[command]) {
  console.log(USAGE);
  process.exit(1);
}

try {
  const [functionName, args] = COMMANDS[command](arg);
  const result = await write(wallet, owner, functionName, args);
  console.log(result.ok ? `Done: ${functionName} (${result.txHash})` : `Reverted: ${result.error}`);
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
