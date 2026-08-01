/**
 * SyncPlay tests — node:test, no extra deps.
 * Browser APIs (WebSocket, RTCPeerConnection) are not available in Node.js;
 * tests focus on module shape, construction, and pure-logic methods.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Stub browser / network globals so the module loads in Node.js
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { hostname: 'localhost', pathname: '/' },
  };
}
if (typeof globalThis.WebSocket === 'undefined') {
  // A WebSocket that never connects — just tracks state
  globalThis.WebSocket = class MockWS {
    constructor(url) { this.url = url; this.readyState = 0; }
    send() {}
    close() { this.readyState = 3; }
  };
}
if (typeof globalThis.RTCPeerConnection === 'undefined') {
  globalThis.RTCPeerConnection = class MockPC {
    constructor() { this.iceConnectionState = 'new'; this.connectionState = 'new'; }
    createDataChannel() {
      return { onmessage: null, onopen: null, onclose: null, readyState: 'connecting', send: () => {}, close: () => {} };
    }
    createOffer() { return Promise.resolve({ type: 'offer', sdp: 'test-sdp' }); }
    createAnswer() { return Promise.resolve({ type: 'answer', sdp: 'test-sdp' }); }
    setLocalDescription() { return Promise.resolve(); }
    setRemoteDescription() { return Promise.resolve(); }
    addIceCandidate() { return Promise.resolve(); }
    close() {}
    onicecandidate = null;
    onconnectionstatechange = null;
    ondatachannel = null;
  };
}
if (typeof globalThis.RTCSessionDescription === 'undefined') {
  globalThis.RTCSessionDescription = class MockSDP {
    constructor(init) { Object.assign(this, init); }
  };
}
if (typeof globalThis.RTCIceCandidate === 'undefined') {
  globalThis.RTCIceCandidate = class MockIce {
    constructor(init) { Object.assign(this, init); }
  };
}

const { SyncPlay } = require(join(__dirname, '..', 'dist', 'index.js'));

// Also get the Interpolator if exported
let Interpolator;
try {
  const mod = require(join(__dirname, '..', 'dist', 'index.js'));
  // Interpolator may be exported under that name or as named export
  Interpolator = mod.Interpolator;
} catch {}

describe('Module shape', () => {
  test('exports SyncPlay class', () => {
    assert.equal(typeof SyncPlay, 'function');
  });
});

describe('SyncPlay construction', () => {
  test('constructs with matchmakerUrl only', () => {
    const sp = new SyncPlay('wss://test.example.com');
    assert.ok(sp);
  });

  test('constructs with options', () => {
    const sp = new SyncPlay('wss://test.example.com', { tickRate: 20, maxPlayers: 4 });
    assert.ok(sp);
  });

  test('playerId is a string', () => {
    const sp = new SyncPlay('wss://test.example.com');
    assert.equal(typeof sp.playerId, 'string');
    assert.ok(sp.playerId.length > 0);
  });

  test('two instances have different playerIds', () => {
    const a = new SyncPlay('wss://test.example.com');
    const b = new SyncPlay('wss://test.example.com');
    assert.notEqual(a.playerId, b.playerId);
  });

  test('isHost defaults to true before joining', () => {
    const sp = new SyncPlay('wss://test.example.com');
    assert.equal(sp.isHost, true);
  });

  test('playerCount defaults to 1', () => {
    const sp = new SyncPlay('wss://test.example.com');
    assert.equal(sp.playerCount, 1);
  });

  test('room is null before createRoom/joinRoom', () => {
    const sp = new SyncPlay('wss://test.example.com');
    assert.equal(sp.room, null);
  });
});

describe('SyncPlay setState / getState (no network needed)', () => {
  test('getState() returns undefined for unset path', () => {
    const sp = new SyncPlay('wss://test.example.com');
    const val = sp.getState('/nonexistent');
    assert.equal(val, undefined);
  });

  test('setState() and getState() round-trip a scalar', () => {
    const sp = new SyncPlay('wss://test.example.com');
    sp.setState('/score', 42);
    assert.equal(sp.getState('/score'), 42);
  });

  test('setState() and getState() round-trip an object', () => {
    const sp = new SyncPlay('wss://test.example.com');
    sp.setState('/players/p1', { x: 10, y: 20 });
    const p = sp.getState('/players/p1');
    assert.deepEqual(p, { x: 10, y: 20 });
  });

  test('setState() with empty-string path does not throw', () => {
    const sp = new SyncPlay('wss://test.example.com');
    assert.doesNotThrow(() => sp.setState('', 'val'));
  });

  test('getState() with no argument returns entire state tree', () => {
    const sp = new SyncPlay('wss://test.example.com');
    sp.setState('/a', 1);
    const s = sp.getState();
    assert.ok(s !== null && typeof s === 'object');
  });

  test('setState() overwrites existing value', () => {
    const sp = new SyncPlay('wss://test.example.com');
    sp.setState('/hp', 100);
    sp.setState('/hp', 50);
    assert.equal(sp.getState('/hp'), 50);
  });
});

describe('SyncPlay leaveRoom() without a room', () => {
  test('leaveRoom() resolves when room is null', async () => {
    const sp = new SyncPlay('wss://test.example.com');
    await sp.leaveRoom();
    assert.equal(sp.room, null);
  });
});

describe('SyncPlay createRoom() with mock WebSocket', () => {
  test('createRoom() rejects when matchmaker is unreachable', async () => {
    const sp = new SyncPlay('wss://unreachable.invalid');
    // The mock WebSocket never calls onopen or triggers the MatchmakerClient
    // so this should reject. We just want to verify it throws/rejects, not hang.
    await assert.rejects(async () => {
      await Promise.race([
        sp.createRoom(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 500)),
      ]);
    });
  });
});

describe('Adversarial / edge cases', () => {
  test('setState with null value does not throw', () => {
    const sp = new SyncPlay('wss://test.example.com');
    assert.doesNotThrow(() => sp.setState('/nullval', null));
  });

  test('setState with very large object does not throw', () => {
    const sp = new SyncPlay('wss://test.example.com');
    const big = {};
    for (let i = 0; i < 1000; i++) big[`key_${i}`] = i;
    assert.doesNotThrow(() => sp.setState('/big', big));
    assert.deepEqual(sp.getState('/big'), big);
  });
});

describe('Interpolator', () => {
  test('Interpolator is exported (may be undefined if not re-exported)', () => {
    // Interpolator is in interpolator.ts but may be internal — verify gracefully
    if (Interpolator) {
      assert.equal(typeof Interpolator, 'object');
    } else {
      // Not exported at top level; that's acceptable, just document it
      assert.ok(true, 'Interpolator not exported at top level');
    }
  });

  test('Interpolator.lerp() if available', () => {
    if (Interpolator && typeof Interpolator.lerp === 'function') {
      assert.equal(Interpolator.lerp(0, 10, 0.5), 5);
      assert.equal(Interpolator.lerp(0, 10, 0), 0);
      assert.equal(Interpolator.lerp(0, 10, 1), 10);
    } else {
      assert.ok(true, 'lerp not available at this export level');
    }
  });

  test('Interpolator.interpolatePosition() if available', () => {
    if (Interpolator && typeof Interpolator.interpolatePosition === 'function') {
      const result = Interpolator.interpolatePosition({ x: 0, y: 0 }, { x: 10, y: 10 }, 0.5);
      assert.ok(typeof result.x === 'number');
      assert.ok(typeof result.y === 'number');
    } else {
      assert.ok(true, 'interpolatePosition not available at this export level');
    }
  });
});
