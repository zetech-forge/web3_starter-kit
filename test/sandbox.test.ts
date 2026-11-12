import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const shared = new URL("../agent/shared.mjs", import.meta.url).href;

function practiceAccount(rpcUrl: string, role: "agent" | "owner") {
  const envKey = role === "agent" ? "AGENT_PRIVATE_KEY" : "OWNER_PRIVATE_KEY";
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { accountFor } from ${JSON.stringify(shared)};
       console.log(accountFor(${JSON.stringify(role)}, ${JSON.stringify(envKey)}, ${role === "agent" ? 1 : 0}).account.address);`,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, [envKey]: "", RPC_URL: rpcUrl },
    },
  );
}

describe("Practice account safety", () => {
  it("allows default accounts on loopback practice endpoints", () => {
    for (const role of ["agent", "owner"] as const) {
      for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
        const result = practiceAccount(`http://${host}:8545`, role);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout.trim(), /^0x[0-9a-fA-F]{40}$/);
      }
    }
  });

  it("refuses default accounts on non-loopback endpoints", () => {
    for (const role of ["agent", "owner"] as const) {
      const result = practiceAccount("https://rpc.example.invalid", role);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Default Hardhat accounts are for local practice chains only/);
    }
  });
});
