import { renderSVG } from "uqr";
import {
  connect,
  connectWallet,
  fetchConfig,
  harvestFeed,
  loadAccount,
  readRules,
  readState,
  sendTx,
} from "./chain.js";
import { buildRounds, quickPicks, summarise } from "./history.js";

const POLL_MS = 1500;
const TIMER_MS = 250;
const CONFIG_CHECK_MS = 10_000;
const CHART_ROUNDS = 20;
const BOARD_SIZE = 10;
const OFFLINE_AFTER_FAILURES = 2;
const SVG_NS = "http://www.w3.org/2000/svg";
const isHost = new URLSearchParams(location.search).has("host");
const $ = (id) => document.getElementById(id);

const app = {
  game: null,
  rules: null,
  wallet: null,
  feed: null,
  state: null,
  rounds: [],
  busy: false,
  failures: 0,
  overlayDismissed: false,
};

const plural = (n, one, many) => `${n} ${BigInt(n) === 1n ? one : many}`;
const me = () => app.wallet?.account.address;

function showView(id) {
  for (const view of document.querySelectorAll("[data-view]"))
    view.hidden = view.id !== id;
}

let toastTimer;
function toast(text, isError = false) {
  const el = $("message");
  el.textContent = text;
  el.classList.toggle("error", isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      el.hidden = true;
    },
    isError ? 6000 : 3000,
  );
}

function secondsLeft() {
  const { rules, game, state } = app;
  const endsAt =
    Number(rules.startTime + (state.round + 1n) * rules.roundSeconds) * 1000;
  return Math.max(0, (endsAt - (Date.now() + game.clockOffsetMs)) / 1000);
}

function renderLake() {
  const { rules, state, rounds } = app;
  const capacity = Number(rules.capacity);
  const stock = Number(state.stock);
  document.body.dataset.lake = state.collapsed
    ? "collapsed"
    : state.stock < rules.collapseBelow * 2n
      ? "low"
      : "ok";
  $("gauge-fill").style.width = `${(stock / capacity) * 100}%`;
  $("gauge-line").style.left =
    `${(Number(rules.collapseBelow) / capacity) * 100}%`;
  $("gauge").setAttribute(
    "aria-label",
    `${stock} of ${capacity} fish left. The lake collapses below ${rules.collapseBelow}.`,
  );
  $("stock").textContent = `${stock} / ${capacity} fish`;
  $("round-label").textContent = `Round ${state.round + 1n}`;

  const previous = rounds.length >= 2 ? rounds[rounds.length - 2].end : null;
  const change = previous === null ? null : state.stock - previous;
  $("trend").textContent =
    change === null
      ? ""
      : change === 0n
        ? "same as last round"
        : `${change > 0n ? "up" : "down"} ${change > 0n ? change : -change} since last round`;
}

function renderTimer() {
  const left = secondsLeft();
  $("timer-fill").style.width =
    `${(left / Number(app.rules.roundSeconds)) * 100}%`;
  $("timer-text").textContent = app.state.collapsed
    ? "The game is over."
    : left > 0
      ? `Next round in ${Math.ceil(left)}s`
      : "Next round starting...";
  if (!isHost) {
    const waiting = app.state.mine?.harvestedThisRound && !app.state.collapsed;
    $("play-note").textContent = waiting
      ? `You can fish again in ${Math.ceil(left)}s.`
      : "";
  }
}

function renderPlayer() {
  const { state } = app;
  if (!state?.mine?.name) return;
  const place = state.board.findIndex((row) => row.address === me()) + 1;
  $("me-name").textContent = state.mine.name;
  $("me-total").textContent =
    `${state.mine.total} fish caught, #${place} of ${state.board.length}`;

  const button = $("harvest");
  const amount = $("amount").value;
  const [disabled, label] = state.collapsed
    ? [true, "The lake is empty"]
    : app.busy
      ? [true, "Sending..."]
      : state.mine.harvestedThisRound
        ? [true, "You fished this round"]
        : [false, `Take ${amount} fish`];
  button.disabled = disabled;
  button.textContent = label;
}

function renderSummary() {
  const last = summarise(app.rounds);
  if (!last) {
    $("summary").textContent = "No rounds finished yet.";
    return;
  }
  const catches =
    last.boats === 0
      ? "nobody fished."
      : `${plural(last.boats, "boat", "boats")} took ${last.taken} fish.`;
  const end = app.rounds[app.rounds.length - 2].end;
  const regrowth = app.state.collapsed
    ? "Nothing regrows now."
    : last.regrew > 0n
      ? `The lake regrew by ${last.regrew}.`
      : end === app.rules.capacity
        ? "The lake is full."
        : "The lake did not regrow.";
  $("summary").textContent = `Round ${last.round + 1n}: ${catches} ${regrowth}`;
}

function boardRow(row, place) {
  const item = document.createElement("li");
  item.value = place;
  if (row.address === me()) item.classList.add("me");
  const line = document.createElement("span");
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = row.name;
  const total = document.createElement("strong");
  total.textContent = String(row.harvested);
  line.append(name, total);
  item.append(line);
  return item;
}

function renderBoard() {
  const { board } = app.state;
  const rows = board.slice(0, BOARD_SIZE).map((row, i) => boardRow(row, i + 1));
  const myPlace = board.findIndex((row) => row.address === me());
  if (myPlace >= BOARD_SIZE) rows.push(boardRow(board[myPlace], myPlace + 1));
  $("board").replaceChildren(...rows);
  const unseen = board.length - rows.length;
  $("board-more").textContent =
    board.length === 0
      ? "Nobody has joined yet."
      : unseen > 0
        ? `and ${unseen} more`
        : "";
  $("player-count").textContent =
    `${plural(board.length, "player", "players")} so far`;
}

function svg(tag, attrs, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs))
    el.setAttribute(key, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderChart() {
  const { rules, rounds } = app;
  const box = $("chart").getBoundingClientRect();
  const [width, height, left, right, top, bottom] = isHost
    ? [Math.max(320, Math.round(box.width)), Math.max(140, Math.round(box.height)), 52, 12, 14, 30]
    : [320, 160, 34, 8, 10, 24];
  $("chart").setAttribute("viewBox", `0 0 ${width} ${height}`);
  const shown = rounds.slice(-CHART_ROUNDS);
  const capacity = Number(rules.capacity);
  const span = Math.max(1, shown.length - 1);
  const x = (i) =>
    left +
    (shown.length === 1
      ? (width - left - right) / 2
      : (i * (width - left - right)) / span);
  const y = (value) =>
    top + (1 - Number(value) / capacity) * (height - top - bottom);

  const nodes = [];
  for (const value of [0, capacity / 2, capacity]) {
    nodes.push(
      svg("line", {
        x1: left,
        x2: width - right,
        y1: y(value),
        y2: y(value),
        class: "grid",
      }),
    );
    nodes.push(
      svg(
        "text",
        { x: left - 6, y: y(value) + (isHost ? 5 : 3.5), class: "axis", "text-anchor": "end" },
        String(Math.round(value)),
      ),
    );
  }
  nodes.push(
    svg("line", {
      x1: left,
      x2: width - right,
      y1: y(rules.collapseBelow),
      y2: y(rules.collapseBelow),
      class: "floor",
    }),
  );

  if (shown.length > 0) {
    const points = shown
      .map((round, i) => `${x(i).toFixed(1)},${y(round.end).toFixed(1)}`)
      .join(" ");
    const last = shown.length - 1;
    nodes.push(
      svg("polygon", {
        points: `${x(0)},${y(0)} ${points} ${x(last)},${y(0)}`,
        class: "area",
      }),
    );
    nodes.push(svg("polyline", { points, class: "line" }));
    nodes.push(
      svg("circle", {
        cx: x(last),
        cy: y(shown[last].end),
        r: isHost ? 7 : 4,
        class: "dot",
      }),
    );
    const first = shown[0].round + 1n;
    const current = shown[last].round + 1n;
    nodes.push(
      svg(
        "text",
        { x: x(0), y: height - (isHost ? 9 : 6), class: "axis", "text-anchor": "start" },
        `Round ${first}`,
      ),
    );
    if (current !== first) {
      nodes.push(
        svg(
          "text",
          { x: x(last), y: height - (isHost ? 9 : 6), class: "axis", "text-anchor": "end" },
          `Round ${current}`,
        ),
      );
    }
  }
  $("chart").replaceChildren(...nodes);
  $("chart").setAttribute(
    "aria-label",
    `Fish in the lake over the last ${plural(shown.length, "round", "rounds")}`,
  );
}

function renderOverlay() {
  const { state, rounds } = app;
  $("collapse-overlay").hidden = !state.collapsed || app.overlayDismissed;
  if (!state.collapsed) return;
  const total = state.board.reduce((sum, row) => sum + row.harvested, 0n);
  const lasted = rounds.findIndex((round) => round.collapsed) + 1;
  $("collapse-detail").textContent =
    `It lasted ${plural(lasted, "round", "rounds")}. Players caught ${total} fish in total.`;
}

function render() {
  renderLake();
  renderTimer();
  renderSummary();
  renderChart();
  renderBoard();
  renderOverlay();
  if (!isHost) renderPlayer();
}

async function refresh() {
  try {
    const [state, harvests] = await Promise.all([
      readState(app.game, me()),
      app.feed(),
    ]);
    app.state = state;
    app.rounds = buildRounds(app.rules, harvests, state.round);
    app.failures = 0;
    $("offline").hidden = true;
    render();
  } catch {
    app.failures += 1;
    if (app.failures >= OFFLINE_AFTER_FAILURES) $("offline").hidden = false;
  }
}

async function act(functionName, args, success) {
  app.busy = true;
  renderPlayer();
  try {
    await sendTx(app.game, app.wallet, functionName, args);
    toast(success);
  } catch (err) {
    toast(err.message, true);
  } finally {
    app.busy = false;
    await refresh();
  }
}

function syncPicks() {
  for (const button of $("picks").children) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.value === $("amount").value),
    );
  }
  renderPlayer();
}

function setUpHarvest() {
  const amount = $("amount");
  amount.max = String(app.rules.maxPerHarvest);
  amount.value = String(app.rules.maxPerHarvest);
  const picks = quickPicks(app.rules.maxPerHarvest).map((n) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(n);
    button.dataset.value = String(n);
    button.addEventListener("click", () => {
      amount.value = String(n);
      syncPicks();
    });
    return button;
  });
  $("picks").replaceChildren(...picks);
  amount.addEventListener("input", syncPicks);
  syncPicks();
  $("harvest").addEventListener("click", () => {
    const n = amount.value;
    act("harvest", [BigInt(n)], `You caught ${n} fish.`);
  });
}

async function startPlayer() {
  app.wallet = await connectWallet(app.game, loadAccount(localStorage));
  const state = await readState(app.game, me());
  $("rule-max").textContent = String(app.rules.maxPerHarvest);
  setUpHarvest();
  showView(state.mine.name ? "play" : "join");

  $("join-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("name").value.trim();
    if (!name) return;
    $("join-button").disabled = true;
    await act("join", [name], `Welcome to the lake, ${name}.`);
    $("join-button").disabled = false;
    if (app.state?.mine?.name) showView("play");
  });
}

function startHost() {
  document.body.classList.add("host");
  $("qr").innerHTML = renderSVG(app.game.joinUrl);
  $("join-url").textContent = app.game.joinUrl;
  showView("host");
}

function watchForNewGame() {
  setInterval(async () => {
    const config = await fetchConfig(location.origin).catch(() => null);
    if (config && config.address !== app.game.contract.address)
      location.reload();
  }, CONFIG_CHECK_MS);
}

async function main() {
  $("overlay-close").addEventListener("click", () => {
    app.overlayDismissed = true;
    $("collapse-overlay").hidden = true;
  });
  try {
    app.game = await connect(location.origin);
    app.rules = await readRules(app.game);
    app.feed = harvestFeed(app.game);
    if (isHost) startHost();
    else await startPlayer();
    await refresh();
    setInterval(refresh, POLL_MS);
    setInterval(() => app.state && renderTimer(), TIMER_MS);
    watchForNewGame();
  } catch (err) {
    $("offline").textContent = err.message;
    $("offline").hidden = false;
  }
}

main();
