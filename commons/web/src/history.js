export function grow(stock, rules) {
  return (
    stock +
    (stock * rules.growthPercent * (rules.capacity - stock)) /
      (rules.capacity * 100n)
  );
}

export function buildRounds(rules, harvests, currentRound) {
  const byRound = new Map();
  for (const harvest of harvests) {
    if (!byRound.has(harvest.round)) byRound.set(harvest.round, []);
    byRound.get(harvest.round).push(harvest);
  }

  const rounds = [];
  let stock = rules.capacity;
  let collapsed = false;
  for (let round = 0n; round <= currentRound; round++) {
    if (round > 0n && !collapsed) stock = grow(stock, rules);
    const start = stock;
    const catches = byRound.get(round) ?? [];
    let taken = 0n;
    for (const harvest of catches) {
      taken += harvest.amount;
      stock = harvest.stockAfter;
    }
    if (catches.length > 0 && stock < rules.collapseBelow) collapsed = true;
    rounds.push({
      round,
      start,
      end: stock,
      taken,
      boats: catches.length,
      collapsed,
    });
  }
  return rounds;
}

export function summarise(rounds) {
  if (rounds.length < 2) return null;
  const last = rounds[rounds.length - 2];
  const now = rounds[rounds.length - 1];
  return {
    round: last.round,
    boats: last.boats,
    taken: last.taken,
    regrew: now.start - last.end,
  };
}

export function quickPicks(maxPerHarvest) {
  const max = Number(maxPerHarvest);
  const picks = [max / 10, max / 5, max / 2, max].map((n) => Math.max(1, Math.round(n)));
  return [...new Set(picks.filter((n) => n >= 1))];
}
