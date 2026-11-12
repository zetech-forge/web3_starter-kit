# Web3 Starter Kit

A standalone Hardhat project for learning Solidity, building a phone-playable
on-chain resource game, and experimenting with an AI agent constrained by a
smart-contract wallet. Everything runs with practice ETH on your laptop.

Extracted from the Web3 & Blockchain track in
[Alumni-x-Student-Hackathon](https://github.com/zetech-forge/Alumni-x-Student-Hackathon)
at revision `d3d2ef0a3516bf3476a8bb4dc382fb5b41752870`. This repository contains
only the starter kit, not the parent site's Jekyll documentation.

## Three challenges

| Challenge | Difficulty | Starting point | Your task |
| --- | --- | --- | --- |
| A: The Pledge | Beginner | `contracts/Pledge.sol` and `test/Pledge.t.sol` | Stake practice ETH on a goal. A referee confirms success strictly before the deadline; otherwise the stake can go to charity at or after the deadline. Adapt and demonstrate the working baseline. |
| B: The Commons | Intermediate | `contracts/Commons.sol`, `commons/`, and `test/Commons.t.sol` | A shared resource regrows each round and collapses if overharvested. Design an on-chain mechanism that keeps it alive. |
| C: Leashed Agent | Advanced | `contracts/PolicyWallet.sol`, `agent/`, and `test/PolicyWallet.t.sol` | An AI agent buys mock data using an allowlisted wallet with spending limits, owner approval, pause and revocation. Configure and demonstrate its policies and try adversarial prompts. |

Unlike the original exercises, the Pledge and PolicyWallet TODOs are completed
here so the existing tests provide a passing baseline. The Commons intentionally
has no conservation mechanism yet: implement your rules in `_mechanism`.
Connect your project to a UN Sustainable Development Goal and be ready to
explain why it needs a blockchain rather than a shared database.

## Requirements

- **Node.js 22.13 or later**, preferably a supported even-numbered LTS release.
- **npm**, bundled with Node.js; use `npm ci` to honor the committed lockfile.
- **Git** and a current browser.
- Hardhat **3.x** and Solidity **0.8.34** are configured by the project.
  Dependencies come from `package-lock.json`; Hardhat downloads the compiler
  on first build, so initial installation and compilation need internet access.
- Optional for Challenge C: [Ollama](https://ollama.com/download) with
  `qwen2.5:3b`, or an OpenAI-compatible API. No model is needed in fake mode.
- Optional for Challenge A: [Remix](https://remix.ethereum.org) in a browser,
  using Solidity 0.8.24 or later and its **Remix VM**.

No separate Foundry installation, browser wallet, faucet or real ETH is required.

## Install, compile and test

```bash
git clone https://github.com/zetech-forge/web3_starter-kit.git
cd web3_starter-kit
npm ci
npm run build
npm test
```

Run all commands from this repository's root. `npm run build` compiles the
contracts; `npm test` runs Solidity contract tests and the Node.js frontend tests.
Keep `package-lock.json` committed and unchanged unless deliberately updating
dependencies. Do not replace `npm ci` with a lockfile-regenerating install.

## Start the local blockchain

In a dedicated terminal:

```bash
npm run chain
```

Leave it running at `http://127.0.0.1:8545` (chain ID **31337**).
It binds to loopback, not the public network. Restarting it clears chain state;
redeploy contracts after a restart. Deployment metadata in `deployments/` is
local, generated state and must not be committed.

## Challenge A: The Pledge

```bash
npx hardhat test solidity test/Pledge.t.sol
```

For a browser-only demo, copy `contracts/Pledge.sol` into Remix, compile and
deploy using **Remix VM**, not a production wallet. Select different VM
accounts for pledger, referee and charity. Supply a practice ETH value when
calling `create(goal, durationSeconds, referee, charity)`. Only the referee can
call `confirm` strictly before the deadline. At or after the deadline, anyone can call
`release` for an active pledge. A settled pledge cannot pay out twice.

The boundary is exclusive for confirmation (`block.timestamp < deadline`) and
inclusive for release (`block.timestamp >= deadline`). Tests cover one second
before, exactly at, and one second after the deadline.

## Challenge B: The Commons

With the practice chain running, use two more terminals:

```bash
# Terminal 2: deploy a new game
npm run deploy:commons

# Terminal 3: build and serve the frontend
npm run game
```

Open `http://localhost:3000/?host` on the big screen. Players open the LAN URL
or QR code printed by the server, on the same trusted Wi-Fi or phone hotspot.
Each phone gets throwaway practice wallets automatically. The server allows
up to three funded players per device; that is not proof of unique humans.
If phones cannot connect, check private-network firewall permissions or use
a hotspot when venue Wi-Fi blocks device-to-device access.

- Design your rules in `contracts/Commons.sol`'s `_mechanism`.
- Change capacity, regrowth, round length and harvest size in
  `scripts/deploy-commons.ts`.
- Edit `commons/web/src/` and `commons/web/index.html` for the UI.
- `npm run build:game` rebuilds the frontend. `npm run game` also builds it
  automatically; the generated `commons/web/game.bundle.js` is not committed.
- `ROUND_SECONDS=15 npm run deploy:commons` starts a faster game on macOS/Linux.
  In PowerShell, set `$env:ROUND_SECONDS="15"` before the deploy command.
- Redeploy to restart the game; open pages pick up the new deployment.
- Run `npx hardhat test solidity test/Commons.t.sol` for focused contract tests.
  Update tests when your intended mechanism changes game rules, and add tests
  for every new rule.

The game server listens on all interfaces so phones can connect, and exposes
a restricted RPC proxy plus practice-wallet funding. Keep it on a trusted LAN;
never expose it to the internet or connect it to a chain containing real funds.

## Challenge C: Leashed Agent

With the local chain running, use separate terminals:

```bash
# Terminal 2
npm run deploy:agent

# Terminal 3
npm run data-api

# Terminal 4: deterministic demo without an external model
LLM_FAKE=1 npm run agent -- "What will the weather be in Kiambu this week?"
```

In PowerShell, set `$env:LLM_FAKE="1"` and then run the agent command.
The deployment funds the wallet with 1 practice ETH. Local account 0 is the
owner, account 1 is the agent, and account 2 is the data seller.
The mock data API defaults to `http://localhost:4021`.

The wallet enforces an allowlist, a 0.05 ETH autonomous spending budget per
one-hour window, and owner approval for payments above 0.02 ETH. Explicit
owner-approved requests are outside the autonomous budget, matching the
original tests. Approval rechecks the payee allowlist, rejects repeat
settlement, and is blocked while paused.

```bash
npm run owner -- pause
npm run owner -- unpause
npm run owner -- revoke
npm run owner -- approve 0
npm run owner -- allow PAYEE_ADDRESS
npm run owner -- block PAYEE_ADDRESS
npm run owner -- agent NEW_AGENT_ADDRESS
npx hardhat test solidity test/PolicyWallet.t.sol
```

These are separate examples, not a sequence to run blindly. Replace
`PAYEE_ADDRESS` and `NEW_AGENT_ADDRESS` with the intended local test addresses;
replace `0` with an existing pending request ID. Requesting does not pay:
the agent submits `requestPayment()`, then the owner calls `approve()` in a
separate on-chain transaction. This is not an off-chain co-signature.
After revocation, restore the local agent or redeploy before continuing.

For a local model, run `ollama pull qwen2.5:3b` and ensure Ollama is running.
Leave `LLM_FAKE` unset (or set to `0`). The default endpoint is
`http://localhost:11434/v1`. Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | Configure an OpenAI-compatible model; never commit the API key. |
| `LLM_FAKE=1` | Use a deliberately trusting deterministic model for adversarial demos. |
| `RPC_URL` | Local practice RPC endpoint, default `http://127.0.0.1:8545`. |
| `DATA_API_URL`, `DATA_API_PORT`, `DATA_PRICE_ETH` | Agent endpoint, mock server port, and mock data price (default 0.001 ETH). |
| `PORT` | Commons server port, default 3000. |
| `ROUND_SECONDS` | Commons round duration at deployment, default 30. |

Set variables in your shell. The JavaScript tools do not automatically load
`.env` files. The mock API imitates an HTTP 402 payment flow with a transaction
hash and payer signature; it is **not** an implementation of the real x402
protocol. Try prompts that request unapproved payees or overspending: the model
may agree, but the contract must refuse.

## Create your team's repository

1. Create a new, empty repository under your own GitHub account or team.
2. Clone this kit and keep its lockfile, contracts, tests, scripts and frontend.
3. Point your clone at your own repository and push:

   ```bash
   git remote rename origin upstream
   git remote add origin https://github.com/YOUR-TEAM/YOUR-PROJECT.git
   git push -u origin HEAD
   ```

4. Replace this README with your project's problem, SDG, architecture, setup,
   demo instructions and team details. Commit your work to **your** repository,
   not the shared starter repository.

## Sandbox and key safety

- **Practice chain only.** Default Hardhat accounts and their public test
  mnemonic are known to everyone. Never fund them on any public chain, reuse
  them for real assets, or import a production wallet into this project.
- Default agent/owner accounts are refused for non-loopback RPC URLs. Do not
  bypass that guard, redirect a local RPC to a public chain, or treat a localhost
  endpoint as proof of safety.
- The code supports explicit `AGENT_PRIVATE_KEY` and `OWNER_PRIVATE_KEY`
  environment overrides. Never give the agent the owner's key. Use separate,
  disposable sandbox credentials only.
- An optional Sepolia configuration reads `SEPOLIA_RPC_URL` and
  `SEPOLIA_PRIVATE_KEY`. The documented deploy/game/agent workflows are local;
  they are not ready-made public-network deployment instructions. Never use
  default Hardhat accounts on Sepolia or any other public network.
- Never commit API keys, private keys, seed phrases, `.env` files or wallet
  exports. `.gitignore` excludes environment files, dependencies, artifacts,
  cache, deployments, generated bundles, build output, logs and temp folders.
  Ignoring files does not remove secrets already committed to Git.
- These educational contracts and servers are **not audited** or production
  infrastructure. Keep the chain and mock API private, use trusted networks,
  and never use real money.

## Known dependency findings

The migration's clean installation reported **13 high-severity npm audit
findings** in the existing locked dependency graph, including transitive
`undici` and `zod` dependencies. These are dependency-audit findings, not a
contract security audit. The original lockfile is deliberately preserved;
do not run `npm audit fix --force` blindly. Evaluate upgrades in a separate
change and rerun all tests before using this kit outside a local sandbox.
