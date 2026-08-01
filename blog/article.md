---
title: "Peer-to-Peer Multiplayer State Sync Without a Game Server: How SyncPlay Actually Works"
description: "An honest walkthrough of SyncPlay's WebRTC dual-DataChannel architecture, what its state replication does and does not guarantee, and the exact API to integrate it."
author: "Soumya Debnath"
date: "2026-07-28"
---

# Peer-to-Peer Multiplayer State Sync Without a Game Server: How SyncPlay Actually Works

*Most casual multiplayer web games do not need a dedicated authoritative server. This article
explains what you get instead when you replicate state peer-to-peer — and, just as
importantly, what you give up.*

Hosted realtime backends charge per concurrent user. For an MMO or a ranked shooter that is
money well spent: you need a trusted server simulating the game. For a co-op puzzle game, a
party game, or a prototype, it is overhead. WebRTC DataChannels let browsers talk directly,
so the only server you need is a small signalling endpoint that helps two peers find each
other.

SyncPlay is a small library for that case. This article documents its real behaviour.

## Q: What is the architecture?

**A:** Peers connect directly over WebRTC. Each pair of peers gets two DataChannels, and the
library replicates a shared JSON state tree between them as deltas.

One peer is designated `hostId` — the lexicographically smallest player ID in the room. Be
clear about what that designation means: it is a **convention your game code can follow**, not
something the library enforces. `hostId` gates nothing. Every peer applies every other peer's
deltas to its own state tree.

If you need a peer that other peers cannot overrule, you need a server. SyncPlay does not
give you one.

## Q: What exactly goes over the wire?

**A:** Batched JSON Pointer deltas, and nothing else:

```json
{ "type": "state-patch",
  "patches": [ { "op": "replace", "path": "/players/a1b2/x", "value": 12 } ] }
```

Note what is absent: no tick index, no sequence number, no sender ID, no timestamp. That
absence defines the engine's guarantees:

- **Ordering is not recoverable.** A frame that arrives late overwrites newer state. There is
  no sequence number to compare against.
- **Convergence is not guaranteed.** Two peers that receive the same deltas in different
  orders end up with different state, and there is no reconciliation pass to repair it.
- **Latency is not measured.** Nothing timestamps a packet, so the library cannot report RTT,
  jitter, or sync time. Treat any latency figure you see in marketing material as
  illustrative rather than measured.

Because deltas are cumulative — `replace /hp 90` is meaningless if you missed
`replace /hp 100` — they are sent on the **reliable, ordered** channel. This is the single
most important transport decision in the library. Sending cumulative deltas on a lossy
channel turns one dropped packet into a permanent desync.

## Q: So what is the unreliable channel for?

**A:** Data where the next update fully supersedes the previous one and staleness is worse
than loss: cursor position, camera rotation, a continuously-sampled analogue stick. Reach it
via `NetworkManager.broadcastUnreliable()`. The engine applies no ordering or dedup there —
that is your problem, and you will need to add your own sequence number.

## Q: Does SyncPlay do client-side prediction or rollback?

**A:** No. It is worth being blunt because the terms get used loosely.

Rollback netcode (GGPO-style) requires a deterministic simulation, an input buffer indexed by
tick, and the ability to re-simulate N frames when a late input arrives. SyncPlay has none of
those pieces — there is no tick index on the wire to build them on.

What it ships is `Interpolator`, a clamped-lerp helper:

```typescript
Interpolator.lerp(0, 10, 0.5);                                   // 5
Interpolator.interpolatePosition({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5);  // { x: 5, y: 10 }
```

That is genuinely useful — call it from `requestAnimationFrame` to smooth an entity toward
its networked position instead of snapping — but it is a two-line maths function. It does not
buffer snapshots, does not interpolate over elapsed time, and does not reconcile a local
prediction against a remote truth.

## Q: What happens if the host disconnects?

**A:** Each remaining peer independently recomputes `hostId` from its own peer list and emits
`host-changed`. That is all that happens.

No game state is transferred to the new host, and the new host is never announced over the
wire, so peers with different views of the membership can disagree about who it is. This is
not a working host-migration feature. If your game cannot tolerate the host vanishing, end
the session.

## Q: What do I actually have to deploy?

**A:** A WebSocket signalling server. **The Go program in `matchmaker/` is not one.** It
registers exactly one route, `POST /api/rooms`, which mints a room ID; it has no WebSocket
upgrade handler at all. The client dials `ws://<host>/ws/<roomId>/<playerId>`, which that
server answers with a 404.

Your signalling server must:

1. Accept `GET /ws/{roomId}/{playerId}` and upgrade to WebSocket.
2. On join, send `{"type":"peer-joined","peerId":"<other>"}` to each existing member, and to
   the newcomer once per existing member.
3. Relay `offer`, `answer` and `ice-candidate` messages, rewriting the sender's `target`
   field into a `peerId` field on the message it delivers.
4. On disconnect, send `{"type":"peer-left","peerId":"<gone>"}` to the remaining members.
5. Answer `POST /api/rooms` with `{"roomId":"<string>"}`.

It relays a handful of small JSON messages per session and holds one socket per player, so a
very small VPS is sufficient. Budget separately for a **TURN relay**: the default ICE
configuration is public STUN only, which cannot traverse symmetric or carrier-grade NAT.
Those peers will not connect at all until you pass your own `iceServers`. TURN relays media
bytes, so it is the one component with a real bandwidth bill.

## Q: How does the cost compare to a hosted backend?

**A:** Honestly: it depends on how many of your players need TURN, which you cannot know
before you ship.

The structural difference is real — you are not paying per concurrent user for a simulation
server. But "$0 infrastructure" is not accurate for a P2P game. You pay for signalling, you
pay for TURN egress for the fraction of players behind restrictive NAT, and under BSL 1.1 you
pay for a commercial license for any production use. Compare against your own vendor quote
with those three line items included rather than against a headline number.

## Integration recipe

```typescript
import { SyncPlay, Interpolator } from
  'https://cdn.jsdelivr.net/gh/itsoumya-d/syncplay@main/dist/index.mjs';

// The first argument is the signalling server URL — a string, not an options object.
const engine = new SyncPlay('wss://signal.mygame.com', {
  tickRate: 20,
  maxPlayers: 8,
  // iceServers: [{ urls: 'turn:turn.mygame.com:3478', username: 'u', credential: 'p' }],
});

// Attach failure handlers before connecting. ICE failure is reported separately from a
// player choosing to leave, so you can tell "unreachable network" from "quit".
engine.on('error',            (err) => console.error(err.code, err.message));
engine.on('peer-failed',      (err) => console.error('unreachable peer', err.peerId, err.code));
engine.on('signaling-closed', (err) => console.error('signalling died', err.message));

const room = await engine.createRoom();     // or: await engine.joinRoom('ROOM-ID')
console.log('room', room.id, 'as', engine.playerId);

engine.on('peer-joined', (id) => {
  if (engine.isHost) engine.setState(`/players/${id}`, { x: 0, y: 0 });
});

engine.on('state-update', () => render());

// Writing state queues a delta, flushed on the next tick.
// Returns false if the path is rejected (empty, non-string, or unsafe).
engine.setState(`/players/${engine.playerId}`, { x: 10, y: 4 });

// Smooth toward the networked position in your render loop.
let vx = 0, vy = 0;
function render() {
  const target = engine.getState(`/players/${engine.playerId}`);
  if (!target) return;
  ({ x: vx, y: vy } = Interpolator.interpolatePosition({ x: vx, y: vy }, target, 0.2));
  draw(vx, vy);
}
```

There is no `sendInput()`, no `broadcastState()`, no `listen()`, and no `lobbyId`. An earlier
version of this article showed all four; none has ever existed. Peers communicate by writing
to the shared state tree with `setState()`.

## When to use this, and when not to

Use it for co-op, private lobbies, party games, game jams, and prototypes — cases where the
players already trust each other and a desync means "restart the round", not "the tournament
result is void".

Do not use it for anything competitive, ranked, or wagered. Every peer can write any value to
any path with no validation, `_playerId` is writable so any peer can claim the host role, and
there is no deterministic simulation to audit. Those are architectural properties of the
design, not bugs waiting to be patched.

## Status

Pre-release, no npm package, no known production adopters, and licensed under BSL 1.1 —
source-available, not open-source, with production use requiring a paid license. Read
`LICENSE` before you plan around it.
