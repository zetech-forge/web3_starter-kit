import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import {
  buildRounds,
  grow,
  quickPicks,
  summarise,
} from "../commons/web/src/history.js";

const rules = { capacity: 1000n, collapseBelow: 100n, growthPercent: 50n };

describe("Commons page history", () => {
  it("regrows with the same formula as the contract", () => {
    assert.equal(grow(900n, rules), 945n);
    assert.equal(grow(500n, rules), 625n);
    assert.equal(grow(1000n, rules), 1000n);
  });

  it("replays harvests round by round", () => {
    const harvests = [
      { round: 0n, amount: 50n, stockAfter: 950n },
      { round: 0n, amount: 50n, stockAfter: 900n },
      { round: 2n, amount: 20n, stockAfter: 950n },
    ];
    const rounds = buildRounds(rules, harvests, 2n);
    assert.deepEqual(
      rounds.map((r) => [r.start, r.end, r.boats]),
      [
        [1000n, 900n, 2],
        [945n, 945n, 0],
        [970n, 950n, 1],
      ],
    );
  });

  it("stops regrowing once the lake collapses", () => {
    const rounds = buildRounds(
      rules,
      [{ round: 0n, amount: 950n, stockAfter: 50n }],
      3n,
    );
    assert.ok(rounds.every((r) => r.collapsed));
    assert.deepEqual(
      rounds.map((r) => r.end),
      [50n, 50n, 50n, 50n],
    );
  });

  it("summarises the last finished round", () => {
    const rounds = buildRounds(
      rules,
      [{ round: 0n, amount: 100n, stockAfter: 900n }],
      1n,
    );
    assert.deepEqual(summarise(rounds), {
      round: 0n,
      boats: 1,
      taken: 100n,
      regrew: 45n,
    });
    assert.equal(summarise(rounds.slice(0, 1)), null);
  });

  it("offers round-number quick picks", () => {
    assert.deepEqual(quickPicks(50n), [5, 10, 25, 50]);
    assert.deepEqual(quickPicks(3n), [1, 2, 3]);
  });

  it("matches the deployed contract round after round", async () => {
    const { viem, networkHelpers } = await network.create();
    const [, amina, brian] = await viem.getWalletClients();
    const commons = await viem.deployContract("Commons", [
      1000n,
      100n,
      50n,
      30n,
      50n,
    ]);
    await commons.write.join(["Amina"], { account: amina.account });
    await commons.write.join(["Brian"], { account: brian.account });

    for (const [aminaTakes, brianTakes] of [
      [50n, 40n],
      [50n, 0n],
      [0n, 0n],
      [30n, 50n],
    ]) {
      if (aminaTakes > 0n)
        await commons.write.harvest([aminaTakes], { account: amina.account });
      if (brianTakes > 0n)
        await commons.write.harvest([brianTakes], { account: brian.account });
      const round = await commons.read.currentRound();
      const events = await commons.getEvents.Harvested({}, { fromBlock: 0n });
      const rounds = buildRounds(
        rules,
        events.map((e) => e.args),
        round,
      );
      assert.equal(rounds.at(-1)?.end, await commons.read.stockNow());
      await networkHelpers.time.increase(30);
    }
  });
});
