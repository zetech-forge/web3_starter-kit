import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const shared = new URL("../agent/shared.mjs", import.meta.url).href;

function practiceAccount(rpcUrl: string) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { accountFor } from ${JSON.stringify(shared)};
       console.log(accountFor("agent", "AGENT_PRIVATE_KEY", 1).account.address);`,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, AGENT_PRIVATE_KEY: "", RPC_URL: rpcUrl },
    },
  );
}

describe("Practice account safety", () => {
  it("allows default accounts on loopback practice endpoints", () => {
    for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
      const result = practiceAccount(`http://${host}:8545`);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout.trim(), /^0x[0-9a-fA-F]{40}$/);
    }
  });

  it("refuses default accounts on non-loopback endpoints", () => {
    const result = practiceAccount("https://rpc.example.invalid");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Default Hardhat accounts are for local practice chains only/);
  });
});
