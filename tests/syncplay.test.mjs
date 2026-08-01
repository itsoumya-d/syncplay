/**
 * SyncPlay tests — node:test, no extra deps.
 *
 * Browser APIs (WebSocket, RTCPeerConnection) do not exist in Node.js, so they are
 * stubbed with controllable fakes. That lets the suite drive the real built code
 * through connection setup, ICE failure and inbound-message handling without a
 * network, which is where the interesting behaviour lives.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ─────────────────────────── controllable browser stubs ───────────────────────────
const bus = { sockets: [], pcs: [] };

class FakeDataChannel {
  constructor(label, opts) {
    this.label = label; this.opts = opts;
    this.readyState = 'connecting';
    this.bufferedAmount = 0;
    this.bufferedAmountLowThreshold = 0;
    this.sent = [];
    this.onmessage = this.onopen = this.onclose = null;
  }
  addEventListener() {}
  send(d) { if (this.readyState !== 'open') throw new Error('InvalidStateError'); this.sent.push(d); }
  close() { this.readyState = 'closed'; }
  _open() { this.readyState = 'open'; if (this.onopen) this.onopen(); }
  _deliver(data) { if (this.onmessage) this.onmessage({ data }); }
}

class FakePC {
  constructor(cfg) {
    this.cfg = cfg;
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
    this.channels = [];
    this.closed = false;
    this.onicecandidate = this.onconnectionstatechange = this.ondatachannel = null;
    bus.pcs.push(this);
  }
  createDataChannel(label, opts) { const c = new FakeDataChannel(label, opts); this.channels.push(c); return c; }
  async createOffer() { return { type: 'offer', sdp: 'fake-offer' }; }
  async createAnswer() { return { type: 'answer', sdp: 'fake-answer' }; }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  async addIceCandidate() {}
  close() { this.closed = true; }
  _setConnectionState(s) {
    this.connectionState = s; this.iceConnectionState = s;
    if (this.onconnectionstatechange) this.onconnectionstatechange();
  }
}

class FakeWS {
  constructor(url) {
    this.url = url; this.readyState = 0; this.sent = [];
    this.onopen = this.onerror = this.onmessage = this.onclose = null;
    bus.sockets.push(this);
  }
  send(d) { if (this.readyState !== 1) throw new Error('InvalidStateError'); this.sent.push(d); }
  close() { this.readyState = 3; if (this.onclose) this.onclose({ code: 1000 }); }
  _open() { this.readyState = 1; if (this.onopen) this.onopen(); }
  _serverClose(code = 1006) { this.readyState = 3; if (this.onclose) this.onclose({ code, wasClean: false }); }
  _deliver(obj) { if (this.onmessage) this.onmessage({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) }); }
}

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { hostname: 'localhost', pathname: '/' },
};
globalThis.WebSocket = FakeWS;
globalThis.RTCPeerConnection = FakePC;
globalThis.RTCSessionDescription = class { constructor(i) { Object.assign(this, i); } };
globalThis.RTCIceCandidate = class { constructor(i) { Object.assign(this, i); } };

const mod = require(join(__dirname, '..', 'dist', 'index.js'));
const { SyncPlay, Interpolator, StateManager, Room, NetworkManager, SyncPlayNetworkError } = mod;

const wait = ms => new Promise(r => setTimeout(r, ms));
/** Short timeouts so failure-path tests finish quickly. */
const FAST = { signalingTimeoutMs: 400, peerHandshakeTimeoutMs: 400, matchmakerTimeoutMs: 400, autoStartGameLoop: false };

/** Bring an engine to a fully connected session with one remote peer. */
async function connectedSession(opts = {}, peerId = 'zz-remote') {
  const engine = new SyncPlay('http://matchmaker.test', { ...FAST, ...opts });
  const p = engine.joinRoom('ROOM01');
  bus.sockets[bus.sockets.length - 1]._open();
  const room = await p;
  const ws = bus.sockets[bus.sockets.length - 1];
  ws._deliver({ type: 'peer-joined', peerId });
  await wait(10);
  const pc = bus.pcs[bus.pcs.length - 1];
  const reliable = pc.channels.find(c => c.label === 'reliable');
  const unreliable = pc.channels.find(c => c.label === 'unreliable');
  reliable._open(); unreliable._open();
  return { engine, room, ws, pc, reliable, unreliable };
}

// ───────────────────────────────── module shape ─────────────────────────────────
describe('Module shape', () => {
  test('exports SyncPlay class', () => {
    assert.equal(typeof SyncPlay, 'function');
  });

  test('exports every symbol the docs advertise', () => {
    // README.md, llms.txt and llms-full.txt all document these as public.
    for (const [name, value] of Object.entries({ Interpolator, StateManager, Room, NetworkManager, SyncPlayNetworkError })) {
      assert.equal(typeof value, 'function', `${name} must be exported from the package root`);
    }
  });
});

describe('SyncPlay construction', () => {
  test('constructs with matchmakerUrl only', () => {
    assert.ok(new SyncPlay('wss://test.example.com'));
  });

  test('constructs with options', () => {
    assert.ok(new SyncPlay('wss://test.example.com', { tickRate: 20, maxPlayers: 4 }));
  });

  test('rejects a non-string first argument with actionable guidance', () => {
    assert.throws(() => new SyncPlay({ mode: 'host', tickRate: 60 }), /matchmaker URL string/);
    assert.throws(() => new SyncPlay(''), TypeError);
  });

  test('playerId is a 32-char hex string', () => {
    const sp = new SyncPlay('wss://test.example.com');
    assert.match(sp.playerId, /^[0-9a-f]{32}$/);
  });

  test('playerIds do not collide across 5000 instances', () => {
    const ids = new Set();
    for (let i = 0; i < 5000; i++) ids.add(new SyncPlay('wss://test.example.com').playerId);
    assert.equal(ids.size, 5000);
  });

  test('isHost defaults to true before joining', () => {
    assert.equal(new SyncPlay('wss://test.example.com').isHost, true);
  });

  test('playerCount defaults to 1', () => {
    assert.equal(new SyncPlay('wss://test.example.com').playerCount, 1);
  });

  test('room is null before createRoom/joinRoom', () => {
    assert.equal(new SyncPlay('wss://test.example.com').room, null);
  });
});

describe('SyncPlay setState / getState (no network needed)', () => {
  test('getState() returns undefined for unset path', () => {
    assert.equal(new SyncPlay('wss://t.example.com').getState('/nonexistent'), undefined);
  });

  test('setState() and getState() round-trip a scalar', () => {
    const sp = new SyncPlay('wss://t.example.com');
    assert.equal(sp.setState('/score', 42), true);
    assert.equal(sp.getState('/score'), 42);
  });

  test('setState() and getState() round-trip an object', () => {
    const sp = new SyncPlay('wss://t.example.com');
    sp.setState('/players/p1', { x: 10, y: 20 });
    assert.deepEqual(sp.getState('/players/p1'), { x: 10, y: 20 });
  });

  test('setState() with empty path is rejected, not silently half-applied', () => {
    const sp = new SyncPlay('wss://t.example.com');
    assert.equal(sp.setState('', 'val'), false);
    assert.deepEqual(sp.getState(), {});
  });

  test('getState() with no argument returns entire state tree', () => {
    const sp = new SyncPlay('wss://t.example.com');
    sp.setState('/a', 1);
    assert.deepEqual(sp.getState(), { a: 1 });
  });

  test('setState() overwrites existing value', () => {
    const sp = new SyncPlay('wss://t.example.com');
    sp.setState('/hp', 100);
    sp.setState('/hp', 50);
    assert.equal(sp.getState('/hp'), 50);
  });

  test('decodes RFC 6901 pointer escapes', () => {
    const sp = new SyncPlay('wss://t.example.com');
    sp.setState('/a~1b', 'slash');
    sp.setState('/c~0d', 'tilde');
    assert.equal(sp.getState()['a/b'], 'slash');
    assert.equal(sp.getState()['c~d'], 'tilde');
  });
});

describe('Prototype pollution', () => {
  test('setState() cannot reach Object.prototype', () => {
    const sp = new SyncPlay('wss://t.example.com');
    for (const p of ['/__proto__/pwn1', '/constructor/prototype/pwn2', '/a/__proto__/pwn3', '/prototype/pwn4']) {
      assert.equal(sp.setState(p, 'PWN'), false, `${p} must be rejected`);
    }
    assert.equal({}.pwn1, undefined);
    assert.equal({}.pwn2, undefined);
    assert.equal({}.pwn3, undefined);
    assert.equal({}.pwn4, undefined);
  });

  test('an inbound peer patch cannot reach Object.prototype', async () => {
    const s = await connectedSession();
    s.reliable._deliver(JSON.stringify({
      type: 'state-patch',
      patches: [{ op: 'replace', path: '/__proto__/remotePwn', value: true }],
    }));
    await wait(10);
    assert.equal({}.remotePwn, undefined);
  });
});

describe('Inbound message handling', () => {
  test('a malformed patch does not discard the rest of the batch', async () => {
    const s = await connectedSession();
    s.reliable._deliver(JSON.stringify({
      type: 'state-patch',
      patches: [
        { op: 'replace', path: '/ok1', value: 1 },
        { op: 'replace', path: null, value: 2 },
        { op: 'replace', path: '/ok2', value: 3 },
      ],
    }));
    await wait(10);
    assert.equal(s.engine.getState('/ok1'), 1);
    assert.equal(s.engine.getState('/ok2'), 3, 'patches after a bad one must still apply');
  });

  test('unimplemented RFC 6902 ops are reported instead of silently no-oping', async () => {
    const s = await connectedSession();
    const rejected = [];
    s.room.on('patches-rejected', r => rejected.push(...r.patches.map(p => p.op)));
    s.reliable._deliver(JSON.stringify({
      type: 'state-patch',
      patches: [{ op: 'move', path: '/x', from: '/y' }, { op: 'test', path: '/x', value: 1 }],
    }));
    await wait(10);
    assert.deepEqual(rejected, ['move', 'test']);
  });

  test('malformed frames never throw out of the handler', async () => {
    const s = await connectedSession();
    for (const d of ['not json', '{}', '{"type":"state-patch"}', '{"type":"state-patch","patches":null}',
                     '{"type":"state-patch","patches":5}', '{"type":"state-patch","patches":"x"}']) {
      assert.doesNotThrow(() => s.reliable._deliver(d));
    }
  });

  test('one throwing listener does not silence the others', async () => {
    const s = await connectedSession();
    const order = [];
    const origError = console.error;
    console.error = () => {};
    try {
      s.room.on('state-update', () => { order.push('A'); throw new Error('app bug'); });
      s.room.on('state-update', () => order.push('B'));
      s.reliable._deliver(JSON.stringify({ type: 'state-patch', patches: [{ op: 'replace', path: '/z', value: 1 }] }));
      await wait(10);
    } finally {
      console.error = origError;
    }
    assert.deepEqual(order, ['A', 'B']);
  });
});

describe('Connection failure surfaces a typed error', () => {
  test('signalling timeout rejects with SyncPlayNetworkError', async () => {
    const sp = new SyncPlay('http://blackhole.test', FAST);
    const started = Date.now();
    await assert.rejects(sp.joinRoom('R'), (err) => {
      assert.ok(err instanceof SyncPlayNetworkError, 'must be a SyncPlayNetworkError');
      assert.equal(err.code, 'signaling-timeout');
      return true;
    });
    assert.ok(Date.now() - started < 2000, 'must honour the configured timeout rather than hang');
  });

  test('signalling socket closing mid-session is reported', async () => {
    const s = await connectedSession();
    const seen = [];
    s.engine.on('signaling-closed', e => seen.push(e.code));
    s.ws._serverClose(1006);
    await wait(20);
    assert.deepEqual(seen, ['signaling-closed']);
  });

  test('ICE failure is distinguishable from a voluntary departure', async () => {
    const s = await connectedSession();
    const events = [];
    s.room.on('peer-left', () => events.push('peer-left'));
    s.room.on('peer-failed', e => events.push('peer-failed:' + e.code));
    s.pc._setConnectionState('failed');
    await wait(20);
    assert.ok(events.includes('peer-failed:ice-failed'), `expected peer-failed, got ${events}`);
    assert.equal(s.pc.closed, true, 'the RTCPeerConnection must be closed, not leaked');
  });

  test('a peer whose handshake never completes times out and is cleaned up', async () => {
    const engine = new SyncPlay('http://m.test', FAST);
    const p = engine.joinRoom('R');
    bus.sockets[bus.sockets.length - 1]._open();
    const room = await p;
    const ws = bus.sockets[bus.sockets.length - 1];
    const codes = [];
    room.on('peer-failed', e => codes.push(e.code));
    ws._deliver({ type: 'offer', peerId: 'zzzz-peer', sdp: { type: 'offer', sdp: 'x' } });
    await wait(20);
    const pc = bus.pcs[bus.pcs.length - 1];
    await wait(600);
    assert.ok(codes.includes('peer-handshake-timeout'), `expected a handshake timeout, got ${codes}`);
    assert.equal(pc.closed, true);
  });

  test('trickled ICE candidates after socket death do not throw', async () => {
    const s = await connectedSession();
    s.ws._serverClose(1006);
    await wait(10);
    assert.doesNotThrow(() => s.pc.onicecandidate({ candidate: { candidate: 'candidate:1 1 udp' } }));
  });

  test('createRoom() rejects when the matchmaker is unreachable', async () => {
    const sp = new SyncPlay('https://unreachable.invalid', FAST);
    await assert.rejects(sp.createRoom(), /Failed to create room/);
  });
});

describe('Room membership', () => {
  test('a re-announced peer is not counted twice', async () => {
    const s = await connectedSession({}, 'dup');
    s.ws._deliver({ type: 'peer-joined', peerId: 'dup' });
    await wait(20);
    assert.equal(s.room.peers.filter(p => p === 'dup').length, 1);
  });

  test('maxPlayers is enforced', async () => {
    const s = await connectedSession({ maxPlayers: 2 }, 'peer-a');
    const rejected = [];
    s.room.on('peer-rejected', r => rejected.push(r.reason));
    for (const id of ['peer-b', 'peer-c']) {
      s.ws._deliver({ type: 'peer-joined', peerId: id });
      await wait(5);
      const rel = bus.pcs[bus.pcs.length - 1].channels.find(c => c.label === 'reliable');
      if (rel) rel._open();
    }
    await wait(20);
    assert.equal(s.room.peers.length, 2);
    assert.ok(rejected.includes('room-full'));
  });

  test('an offer collision does not create a second RTCPeerConnection', async () => {
    const engine = new SyncPlay('http://m.test', FAST);
    engine._playerId = 'aaaa';
    const p = engine.joinRoom('R');
    bus.sockets[bus.sockets.length - 1]._open();
    await p;
    const ws = bus.sockets[bus.sockets.length - 1];
    ws._deliver({ type: 'peer-joined', peerId: 'bbbb' });
    await wait(20);
    const countAfterOffer = bus.pcs.length;
    ws._deliver({ type: 'offer', peerId: 'bbbb', sdp: { type: 'offer', sdp: 'theirs' } });
    await wait(20);
    assert.equal(bus.pcs.length, countAfterOffer, 'glare must not build a duplicate connection');
  });

  test('leaveRoom() detaches the room so patches are not applied twice', async () => {
    const engine = new SyncPlay('http://m.test', FAST);
    const rooms = [];
    for (let i = 0; i < 3; i++) {
      const p = engine.joinRoom('R' + i);
      bus.sockets[bus.sockets.length - 1]._open();
      rooms.push(await p);
    }
    const ws = bus.sockets[bus.sockets.length - 1];
    ws._deliver({ type: 'peer-joined', peerId: 'zz' });
    await wait(10);
    const rel = bus.pcs[bus.pcs.length - 1].channels.find(c => c.label === 'reliable');
    rel._open();
    const hits = rooms.map(() => 0);
    rooms.forEach((r, i) => r.on('state-update', () => hits[i]++));
    rel._deliver(JSON.stringify({ type: 'state-patch', patches: [{ op: 'replace', path: '/n', value: 1 }] }));
    await wait(20);
    assert.deepEqual(hits, [0, 0, 1], 'only the current room may receive updates');
  });
});

describe('Game loop and transport choice', () => {
  test('state deltas are broadcast on the reliable, ordered channel', async () => {
    const s = await connectedSession({ autoStartGameLoop: true, tickRate: 50 });
    s.engine.setState('/p/x', 1);
    await wait(80);
    s.room.stopGameLoop();
    assert.ok(s.reliable.sent.length > 0, 'a cumulative delta must not be sent on a lossy channel');
    assert.equal(s.unreliable.sent.length, 0);
  });

  test('startGameLoop rejects a nonsensical tickRate', async () => {
    const s = await connectedSession();
    assert.throws(() => s.room.startGameLoop(0), RangeError);
    assert.throws(() => s.room.startGameLoop(-5), RangeError);
    assert.throws(() => s.room.startGameLoop(NaN), RangeError);
  });

  test('the pending-patch buffer is capped', async () => {
    const s = await connectedSession();
    const reasons = [];
    s.room.on('patches-dropped', d => reasons.push(d.reason));
    for (let i = 0; i < 12000; i++) s.engine.setState('/x', i);
    assert.ok(reasons.includes('game-loop-not-started'), 'overflow must be diagnosable');
  });
});

describe('Interpolator', () => {
  test('is exported from the package root', () => {
    assert.equal(typeof Interpolator, 'function');
  });

  test('lerp clamps t to [0,1]', () => {
    assert.equal(Interpolator.lerp(0, 10, 0.5), 5);
    assert.equal(Interpolator.lerp(0, 10, 0), 0);
    assert.equal(Interpolator.lerp(0, 10, 1), 10);
    assert.equal(Interpolator.lerp(0, 10, -3), 0);
    assert.equal(Interpolator.lerp(0, 10, 7), 10);
  });

  test('interpolatePosition works as a static, exactly as documented', () => {
    assert.deepEqual(Interpolator.interpolatePosition({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5), { x: 5, y: 10 });
  });

  test('interpolatePosition also works on an instance', () => {
    assert.deepEqual(new Interpolator().interpolatePosition({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5), { x: 5, y: 10 });
  });
});

describe('Adversarial / edge cases', () => {
  test('setState with null value does not throw', () => {
    const sp = new SyncPlay('wss://t.example.com');
    assert.doesNotThrow(() => sp.setState('/nullval', null));
    assert.equal(sp.getState('/nullval'), null);
  });

  test('setState with a very large object does not throw', () => {
    const sp = new SyncPlay('wss://t.example.com');
    const big = {};
    for (let i = 0; i < 1000; i++) big[`key_${i}`] = i;
    assert.doesNotThrow(() => sp.setState('/big', big));
    assert.deepEqual(sp.getState('/big'), big);
  });

  test('a path traversing a scalar is rejected rather than corrupting state', () => {
    const sp = new SyncPlay('wss://t.example.com');
    sp.setState('/a', 5);
    assert.equal(sp.setState('/a/b/c', 1), false);
    assert.equal(sp.getState('/a'), 5);
  });

  test('unicode and very deep paths round-trip', () => {
    const sp = new SyncPlay('wss://t.example.com');
    sp.setState('/players/日本語/名前', 'ok');
    assert.equal(sp.getState('/players/日本語/名前'), 'ok');
    const deep = '/' + Array.from({ length: 200 }, (_, i) => 'k' + i).join('/');
    assert.equal(sp.setState(deep, 1), true);
    assert.equal(sp.getState(deep), 1);
  });

  test('leaveRoom() resolves when room is null', async () => {
    const sp = new SyncPlay('wss://t.example.com');
    await sp.leaveRoom();
    assert.equal(sp.room, null);
  });
});
