# Pocket Table

A local Texas Hold’em companion for physical playing cards. The Mac hosts the dealer dashboard; each player uses a phone. Chips are virtual bookkeeping units. There is no payment or money-transfer integration.

## Install on your Mac

You need **Node.js 26 or newer**, npm, Git, and an `openssl` executable on your PATH. Node 26 is the tested runtime. The HTTPS server generates its own local certificate on first start.

```sh
git clone https://github.com/vishaljha2121/pocket-table.git
cd pocket-table
npm ci
npm start
```

Open **http://localhost:8787/dealer** on that Mac. The server prints the phone URL, and the dashboard displays a QR code and table code. Players use Safari or Chrome on the same Wi-Fi. No accounts or app installs are required.

For background operation on macOS, stop the foreground server with Ctrl+C, then double-click **Start Poker.command** (or run `./"Start Poker.command"`). The start script detects the checkout location and Node executable and generates a local launchd configuration. It does not change system firewall settings or install a login item.

## Play

1. Open **http://localhost:8787/dealer** on the hosting Mac.
2. Keep the Mac powered, lid open, and on the same network as all phones.
3. Set blinds and the starting stack before approving seats.
4. Players scan the dashboard QR code, choose a name, and save their private recovery code.
5. The dealer approves players and arranges the seat order with each player’s menu.
6. Deal physical hole cards, then click **Start first hand**. Players enter their cards privately after the hand starts if they want the helper.
7. Players act on their phones. Only the current player can make a legal action. Raises mean the **total bet for this street**, not the extra amount.
8. After betting closes, enter the physical flop, turn, and river. At showdown, verify physical hands and select the winner(s) for each pot. Tied winners share that pot.
9. Deal the next hand. The button and blinds rotate automatically; the Mac operator can remain the dealer throughout.

The Mac operator can play too: use a separate phone for their player seat.

## Local network and HTTPS

- **Mac dealer:** `http://localhost:8787/dealer`
- **Phones:** use the QR code or exact HTTPS address displayed by the dealer dashboard, typically `https://<MAC_LAN_IP>:8788/play?room=<TABLE_CODE>`.
- **Table code:** generated locally on first start; retained in the local database.

Do not substitute your phone's IP for the Mac's IP. If the Mac's IP changes, stop and start the server and use the new dashboard QR code. Guest Wi-Fi isolation, different networks, and VPN policies can prevent phones from reaching the Mac.

Phones connect over HTTPS with a locally generated, self-signed certificate. A browser warning on the first visit is expected; the person using the phone must review and continue themselves. Only use the exact local address from your own Mac’s dashboard. No certificate authority is installed on any device. The Mac-only dashboard uses loopback HTTP. Remote HTTP visits redirect to HTTPS.

## Start and stop

Double-click **Start Poker.command** to start the background service and open the dealer dashboard. Double-click **Stop Poker.command** when done. Once started, the service survives closing the terminal and restarts if its process crashes. It does not install a login item; start it again after logging out or rebooting.

The running service prevents idle sleep. Closing the lid, explicitly sleeping, shutting down, or changing networks can still disconnect players. Stop the service when not playing.

Game state, sessions, and action history are saved in `data/table.sqlite`. A restarted active game is paused until players reconnect and the dealer resumes. The current player being absent for about 45 seconds also pauses the table. Nobody is silently folded.

For a foreground development server (stop the background service first):

```sh
cd pocket-table
npm start
```

The app has no runtime internet dependency after `npm ci`.

For foreground development, optional environment variables are `PORT` (HTTP, default 8787), `TLS_PORT` (HTTPS, default 8788), `LAN_IP` (override network-interface detection), and `DATA_DIR` (isolated database/certificate directory). The background launcher uses the defaults. If you have multiple network adapters, set `LAN_IP` to the address reachable by players and run `npm start` in the foreground.

```sh
LAN_IP=192.168.1.50 npm start
```

The example IP is a placeholder; use your Mac's actual address. Do not run two server processes against the same data directory.

## Private hand helper

In **My hand & odds**, enter two physical hole cards. The phone shows the best five-card hand, a ranking legend, straight/flush draws, and estimated win/tie/equity plus final hand-category probabilities from 4,000 simulated deals.

All calculations run in a local browser worker. Hole cards stay in browser memory: they are not sent to the Mac, stored in the game database, or included in exports. They clear at the hand’s end, the next hand, or a page reload. If a mistakenly entered card collides with the board, the helper asks you to correct it.

The helper assumes random unknown opponent hands and unknown folded cards. It is not a GTO solver, an opponent-range model, a betting recommendation, or a guarantee of winning. Equity means the average share of a single pot with equal eligibility; it is not expected payout across side pots. Draw-completing cards may also help opponents. Physical cards, not private entries, determine payouts.

## Rules and fairness

- 2–10 seats; no-limit Texas Hold’em; integer chip units.
- Correct heads-up order, blinds/button rotation, minimum raises, short all-in reopening rules, street completion, and all-in runouts.
- Main/side pots with eligibility, uncalled-bet refunds, split pots, and odd chips clockwise left of the button.
- Dealer approval for joining; additions/removals/rebuys/sitting-out/seat moves between hands.
- Server-authoritative balances, turn validation, version checks, and duplicate-request protection.
- Player sessions are separate from dealer permission. Dealer bootstrap works only over a loopback connection using a localhost host name. Players cannot call dealer actions.
- Recovery codes rotate the old player session when used. Anyone holding a recovery code can reclaim that seat, so keep it private.
- Dealer-entered verbal actions, rebuys, payouts, and pauses are publicly logged.
- A dealing mistake can void/refund an active hand only after all involved players approve on their phones. Dealer can cancel the request; the table stays paused until resumed.

The Mac/dealer and the physical game remain trusted. The software cannot prevent collusion, marked cards, screen-peeking, a dishonest winner declaration, or the Mac owner modifying the program. Browser privacy also depends on the player’s device. Table-wide assistance is available equally to all players.

This first version uses fixed blinds editable between hands; scheduled blind levels, antes, tournament clocks, automatic winner recognition, custom ranges, true GTO strategy, and TV support are not included.

## Project layout

| Path                                        | Purpose                                                             |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `engine.ts`                                 | Betting rules, chip accounting, pots, and payouts                   |
| `server.ts`                                 | Local HTTP/HTTPS service, authentication, SQLite persistence        |
| `public/`                                   | Responsive dealer/player UI and browser-only hand evaluator         |
| `test/`                                     | Rule, randomized, integration, and exhaustive evaluator checks      |
| `scripts/configure-service.mjs`             | Portable macOS background-service configuration                     |
| `Start Poker.command`, `Stop Poker.command` | macOS launch/stop shortcuts                                         |
| `data/`                                     | Local-only runtime state, certificates, and logs; excluded from Git |

## Repository and data handling

Only source code, dependency lockfile, tests, and instructions belong in Git. The `.gitignore` excludes installed dependencies, saved games, player sessions, recovery-token hashes, local certificates/private keys, logs, environment files, and machine-specific service configuration.

Back up `data/` privately if you need to preserve a session. Do not upload it to GitHub. Use **Export** in the dealer UI for game history without authentication credentials or hole cards. There is no cloud backend or telemetry.

## Validation

```sh
npm test
node test/integration.mjs
node test/evaluator-exhaustive.mjs
```

- Unit/rule suite covers heads-up order, all streets, all-in reopening, side pots, fold wins, tied payouts, odd chips, duplicate cards, void approvals, and seat removal.
- 500 deterministic randomized complete hands verify termination and chip conservation.
- Integration test runs an isolated 3-player server on ports 8791/8792. It verifies role restrictions, cross-origin denial, invalid turns, duplicate/stale requests, trusted TLS, recovery-session rotation, privacy projections, exports, and restart persistence.
- Evaluator test checks all 2,598,960 five-card combinations against standard category counts and 1,000 seven-card hands against all constituent five-card subsets.
- Dealer and player screens were inspected in Chrome. Actual phone access on local Wi-Fi was confirmed by the user. Exhaustive physical-phone browser compatibility was not tested.

The integration tests use temporary databases, never your live table. **Export** on the dealer screen downloads action-state history; no private hole cards or session tokens are included.
