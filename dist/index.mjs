// src/license-validator.ts
function readEnv(name) {
  const proc = globalThis.process;
  return proc && proc.env ? proc.env[name] : void 0;
}
var LicenseValidator = class _LicenseValidator {
  static AUTHOR = "Soumya Debnath";
  static CONTACT = "soumyadebnath1619@gmail.com";
  /** The banner is informational; print it once per process, not once per instance. */
  static warned = false;
  static validate(options) {
    const key = options?.licenseKey || readEnv("COMMERCIAL_LICENSE_KEY");
    const isDev = typeof window !== "undefined" ? window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" : readEnv("NODE_ENV") !== "production";
    if (isDev || options?.allowEval) {
      return true;
    }
    if (!key || !key.startsWith("BSL11-")) {
      if (!_LicenseValidator.warned) {
        _LicenseValidator.warned = true;
        console.warn(
          `
================================================================================
COMMERCIAL USE NOTICE \u2014 BUSINESS SOURCE LICENSE 1.1
Product: SYNCPLAY | Copyright (c) 2024-2026 ${_LicenseValidator.AUTHOR}

Production use of this software requires a valid paid commercial license key.
See LICENSE and COMMERCIAL_LICENSE.md for the terms.

Commercial licensing enquiries: ${_LicenseValidator.CONTACT}
================================================================================
`
        );
      }
      return false;
    }
    return true;
  }
};

// src/events.ts
var EventEmitter = class {
  listeners = /* @__PURE__ */ new Map();
  on(event, cb) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, /* @__PURE__ */ new Set());
    }
    this.listeners.get(event).add(cb);
    return this;
  }
  /** Remove a single listener. Required to unsubscribe a Room on leaveRoom(). */
  off(event, cb) {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(cb);
      if (set.size === 0) this.listeners.delete(event);
    }
    return this;
  }
  /** Remove every listener for one event, or all events when omitted. */
  removeAllListeners(event) {
    if (event === void 0) this.listeners.clear();
    else this.listeners.delete(event);
    return this;
  }
  listenerCount(event) {
    return this.listeners.get(event)?.size ?? 0;
  }
  emit(event, ...args) {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return false;
    for (const cb of Array.from(set)) {
      try {
        cb(...args);
      } catch (err) {
        if (event !== "listener_error" && this.listenerCount("listener_error") > 0) {
          this.emit("listener_error", { event, error: err });
        } else if (typeof console !== "undefined") {
          console.error(`SyncPlay: listener for "${event}" threw:`, err);
        }
      }
    }
    return true;
  }
};

// src/room.ts
var MAX_PENDING_PATCHES = 1e4;
var Room = class extends EventEmitter {
  constructor(id, localPlayerId, network, stateManager, maxPlayers = Infinity) {
    super();
    this.id = id;
    this.localPlayerId = localPlayerId;
    this.network = network;
    this.stateManager = stateManager;
    this.maxPlayers = maxPlayers;
    this.hostId = localPlayerId;
    this.peers.push(localPlayerId);
    this.subscribe(this.network, "peer-connected", (peerId) => {
      if (this.peers.includes(peerId)) return;
      if (this.peers.length >= this.maxPlayers) {
        this.emit("peer-rejected", { peerId, reason: "room-full", maxPlayers: this.maxPlayers });
        return;
      }
      this.peers.push(peerId);
      this.peers.sort();
      this.evaluateHost();
      this.emit("peer-joined", peerId);
    });
    this.subscribe(this.network, "peer-left", (peerId) => {
      this.peers = this.peers.filter((p) => p !== peerId);
      this.evaluateHost();
      this.emit("peer-left", peerId);
    });
    this.subscribe(this.network, "peer-failed", (err) => this.emit("peer-failed", err));
    this.subscribe(this.network, "signaling-closed", (err) => this.emit("signaling-closed", err));
    this.subscribe(this.network, "error", (err) => this.emit("error", err));
    this.subscribe(this.network, "message", (msg) => {
      let parsed;
      try {
        parsed = typeof msg.data === "string" ? JSON.parse(msg.data) : JSON.parse(new TextDecoder().decode(msg.data));
      } catch {
        this.emit("message-rejected", { peerId: msg.peerId, reason: "unparseable" });
        return;
      }
      if (parsed === null || typeof parsed !== "object") {
        this.emit("message-rejected", { peerId: msg.peerId, reason: "not-an-object" });
        return;
      }
      if (parsed.type !== "state-patch") return;
      if (!Array.isArray(parsed.patches)) {
        this.emit("message-rejected", { peerId: msg.peerId, reason: "patches-not-an-array" });
        return;
      }
      const applied = [];
      const rejected = [];
      for (const patch of parsed.patches) {
        if (this.stateManager.applyPatch(patch)) applied.push(patch);
        else rejected.push(patch);
      }
      if (rejected.length > 0) {
        this.emit("patches-rejected", { peerId: msg.peerId, count: rejected.length, patches: rejected });
      }
      if (applied.length > 0) this.emit("state-update", applied);
    });
    this.subscribe(this.stateManager, "patch_generated", (patch) => {
      if (this.pendingPatches.length >= MAX_PENDING_PATCHES) {
        this.pendingPatches.shift();
        this.droppedPatches++;
        if (this.droppedPatches === 1 || this.droppedPatches % 1e3 === 0) {
          this.emit("patches-dropped", {
            total: this.droppedPatches,
            reason: this.loopInterval ? "tick-rate-too-low" : "game-loop-not-started"
          });
        }
      }
      this.pendingPatches.push(patch);
    });
  }
  id;
  localPlayerId;
  network;
  stateManager;
  maxPlayers;
  loopInterval = null;
  pendingPatches = [];
  droppedPatches = 0;
  /** Listeners this Room installed on shared objects, so they can be removed. */
  subscriptions = [];
  peers = [];
  hostId;
  subscribe(target, event, cb) {
    target.on(event, cb);
    this.subscriptions.push([target, event, cb]);
  }
  /**
   * Detach every listener this Room installed on the shared NetworkManager and
   * StateManager. Without this, each createRoom()/joinRoom() left its listeners
   * attached, so one inbound message was applied once per historical Room.
   */
  destroy() {
    this.stopGameLoop();
    for (const [target, event, cb] of this.subscriptions) target.off(event, cb);
    this.subscriptions = [];
    this.removeAllListeners();
  }
  evaluateHost() {
    if (this.peers.length === 0) return;
    const oldHost = this.hostId;
    this.hostId = this.peers[0];
    if (this.hostId !== oldHost) {
      this.emit("host-changed", this.hostId);
      if (this.hostId === this.localPlayerId) this.emit("host-migrated", this.localPlayerId);
    }
  }
  get isHost() {
    return this.hostId === this.localPlayerId;
  }
  startGameLoop(tickRate = 20) {
    if (!Number.isFinite(tickRate) || tickRate <= 0) {
      throw new RangeError(`SyncPlay: tickRate must be a positive finite number, got ${tickRate}`);
    }
    if (this.loopInterval) clearInterval(this.loopInterval);
    const tickMs = 1e3 / tickRate;
    this.loopInterval = setInterval(() => {
      if (this.pendingPatches.length > 0) {
        const patches = this.pendingPatches;
        this.pendingPatches = [];
        this.network.broadcastReliable(JSON.stringify({ type: "state-patch", patches }));
      }
      this.emit("tick");
    }, tickMs);
  }
  onStateUpdate(callback) {
    this.on("state-update", callback);
  }
  stopGameLoop() {
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
  }
};

// src/state-manager.ts
var FORBIDDEN_KEYS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
var SUPPORTED_OPS = /* @__PURE__ */ new Set(["add", "replace", "remove"]);
function decodeSegment(segment) {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}
var StateManager = class extends EventEmitter {
  state = {};
  /**
   * Split and validate a JSON Pointer path. Returns null when the path is
   * unusable (wrong type, empty, or containing a prototype-polluting segment).
   * Never throws.
   */
  parsePath(path) {
    if (typeof path !== "string") return null;
    const keys = path.split("/").filter(Boolean).map(decodeSegment);
    if (keys.length === 0) return null;
    for (const k of keys) {
      if (FORBIDDEN_KEYS.has(k)) return null;
    }
    return keys;
  }
  /**
   * Apply a single patch to the local state tree.
   *
   * Returns true when the patch was applied and false when it was rejected.
   * Rejections are reported via the `patch_rejected` event instead of throwing,
   * so a single bad patch cannot abort the remainder of an inbound batch.
   */
  applyPatch(patch) {
    if (patch === null || typeof patch !== "object") {
      this.emit("patch_rejected", { patch, reason: "not-an-object" });
      return false;
    }
    if (!SUPPORTED_OPS.has(patch.op)) {
      this.emit("patch_rejected", { patch, reason: `unsupported-op:${String(patch.op)}` });
      return false;
    }
    const keys = this.parsePath(patch.path);
    if (!keys) {
      this.emit("patch_rejected", { patch, reason: "invalid-or-unsafe-path" });
      return false;
    }
    let current = this.state;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      const next = current[k];
      if (next === void 0 || next === null) {
        current[k] = {};
      } else if (typeof next !== "object") {
        this.emit("patch_rejected", { patch, reason: `path-traverses-non-object-at:${k}` });
        return false;
      }
      current = current[k];
    }
    const lastKey = keys[keys.length - 1];
    if (patch.op === "replace" || patch.op === "add") {
      current[lastKey] = patch.value;
    } else {
      delete current[lastKey];
    }
    this.emit("state_changed", this.state);
    return true;
  }
  /** Returns true when the value was stored, false when the path was rejected. */
  setState(path, value) {
    const patch = { op: "replace", path, value };
    if (!this.applyPatch(patch)) return false;
    this.emit("patch_generated", patch);
    return true;
  }
  getState(path) {
    if (!path) return this.state;
    const keys = this.parsePath(path);
    if (!keys) return void 0;
    let current = this.state;
    for (const key of keys) {
      if (current === void 0 || current === null) return void 0;
      current = current[key];
    }
    return current;
  }
};

// src/network-manager.ts
var SyncPlayNetworkError = class extends Error {
  code;
  peerId;
  constructor(code, message, peerId) {
    super(message);
    this.name = "SyncPlayNetworkError";
    this.code = code;
    this.peerId = peerId;
  }
};
var DEFAULT_SIGNALING_TIMEOUT_MS = 15e3;
var DEFAULT_PEER_HANDSHAKE_TIMEOUT_MS = 2e4;
var NetworkManager = class _NetworkManager extends EventEmitter {
  constructor(iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" }
  ], signalingTimeoutMs = DEFAULT_SIGNALING_TIMEOUT_MS, peerHandshakeTimeoutMs = DEFAULT_PEER_HANDSHAKE_TIMEOUT_MS) {
    super();
    this.iceServers = iceServers;
    this.signalingTimeoutMs = signalingTimeoutMs;
    this.peerHandshakeTimeoutMs = peerHandshakeTimeoutMs;
  }
  iceServers;
  signalingTimeoutMs;
  peerHandshakeTimeoutMs;
  peers = /* @__PURE__ */ new Map();
  handshakeTimers = /* @__PURE__ */ new Map();
  ws = null;
  localId = "";
  connected = false;
  beforeUnloadHandler = null;
  async connect(signalingUrl, roomId, playerId) {
    this.localId = playerId;
    if (typeof roomId !== "string" || roomId.length === 0) {
      throw new SyncPlayNetworkError("signaling-error", `SyncPlay: invalid roomId ${JSON.stringify(roomId)}`);
    }
    return new Promise((resolve, reject) => {
      let wsUrl = signalingUrl;
      if (wsUrl.startsWith("http")) wsUrl = wsUrl.replace("http", "ws");
      let settled = false;
      let timer = null;
      const finish = (err) => {
        if (settled) return false;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        if (err) reject(err);
        else resolve();
        return true;
      };
      let ws;
      try {
        ws = new WebSocket(`${wsUrl}/ws/${encodeURIComponent(roomId)}/${encodeURIComponent(playerId)}`);
      } catch (err) {
        finish(new SyncPlayNetworkError(
          "signaling-error",
          `SyncPlay: cannot open signalling socket to ${wsUrl} \u2014 ${err.message}`
        ));
        return;
      }
      this.ws = ws;
      timer = setTimeout(() => {
        if (finish(new SyncPlayNetworkError(
          "signaling-timeout",
          `SyncPlay: signalling server did not respond within ${this.signalingTimeoutMs}ms (${wsUrl})`
        ))) {
          try {
            ws.close();
          } catch {
          }
        }
      }, this.signalingTimeoutMs);
      ws.onopen = () => {
        this.connected = true;
        finish();
      };
      ws.onerror = () => {
        const err = new SyncPlayNetworkError(
          "signaling-error",
          `SyncPlay: signalling connection to ${wsUrl} failed`
        );
        if (!finish(err)) this.emit("error", err);
      };
      ws.onclose = (event) => {
        const wasConnected = this.connected;
        this.connected = false;
        const err = new SyncPlayNetworkError(
          "signaling-closed",
          `SyncPlay: signalling connection closed (code ${event?.code ?? "unknown"})`
        );
        if (!finish(err) && wasConnected) {
          this.emit("signaling-closed", err);
          this.emit("error", err);
        }
      };
      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          this.emit("error", new SyncPlayNetworkError(
            "signaling-error",
            "SyncPlay: received malformed signalling message, ignoring"
          ));
          return;
        }
        if (msg === null || typeof msg !== "object" || typeof msg.type !== "string") {
          this.emit("error", new SyncPlayNetworkError(
            "signaling-error",
            'SyncPlay: signalling message missing a string "type", ignoring'
          ));
          return;
        }
        this.dispatch(msg).catch((err) => {
          this.emit("error", new SyncPlayNetworkError(
            "signaling-error",
            `SyncPlay: failed to handle "${msg.type}" from ${msg.peerId} \u2014 ${err.message}`,
            msg.peerId
          ));
        });
      };
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        this.beforeUnloadHandler = () => this.disconnect();
        window.addEventListener("beforeunload", this.beforeUnloadHandler);
      }
    });
  }
  async dispatch(msg) {
    switch (msg.type) {
      case "peer-joined":
        await this.handlePeerJoined(msg.peerId);
        break;
      case "offer":
        await this.handleOffer(msg.peerId, msg.sdp);
        break;
      case "answer":
        await this.handleAnswer(msg.peerId, msg.sdp);
        break;
      case "ice-candidate":
        await this.handleIceCandidate(msg.peerId, msg.candidate);
        break;
      case "peer-left":
        this.handlePeerLeft(msg.peerId);
        break;
      default:
        break;
    }
  }
  /** Send on the signalling socket only when it is actually open. */
  signal(payload) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch (err) {
      this.emit("error", new SyncPlayNetworkError(
        "signaling-error",
        `SyncPlay: failed to send on signalling socket \u2014 ${err.message}`
      ));
      return false;
    }
  }
  createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.signal({ type: "ice-candidate", target: peerId, candidate: event.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        this.emit("peer-failed", new SyncPlayNetworkError(
          "ice-failed",
          `SyncPlay: ICE failed for peer ${peerId}. No TURN relay is configured by default, so symmetric and carrier-grade NAT cannot be traversed. Pass iceServers with a TURN entry to fix this.`,
          peerId
        ));
        this.teardownPeer(peerId, "ice-failed");
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "closed") {
        this.teardownPeer(peerId, "disconnected");
      } else if (pc.connectionState === "connected") {
        this.clearHandshakeTimer(peerId);
      }
    };
    this.handshakeTimers.set(peerId, setTimeout(() => {
      const entry = this.peers.get(peerId);
      if (entry && entry.announced) return;
      this.emit("peer-failed", new SyncPlayNetworkError(
        "peer-handshake-timeout",
        `SyncPlay: peer ${peerId} did not complete its WebRTC handshake within ${this.peerHandshakeTimeoutMs}ms`,
        peerId
      ));
      this.teardownPeer(peerId, "handshake-timeout");
    }, this.peerHandshakeTimeoutMs));
    return pc;
  }
  clearHandshakeTimer(peerId) {
    const t = this.handshakeTimers.get(peerId);
    if (t !== void 0) {
      clearTimeout(t);
      this.handshakeTimers.delete(peerId);
    }
  }
  setupDataChannels(peerId, reliable, unreliable) {
    reliable.onmessage = (event) => this.emit("message", { peerId, data: event.data, reliable: true });
    unreliable.onmessage = (event) => this.emit("message", { peerId, data: event.data, reliable: false });
    const announce = () => {
      const entry = this.peers.get(peerId);
      if (!entry || entry.announced) return;
      if (reliable.readyState !== "open") return;
      entry.announced = true;
      this.clearHandshakeTimer(peerId);
      this.emit("peer-connected", peerId);
    };
    reliable.onopen = announce;
    if (reliable.readyState === "open") announce();
    reliable.onclose = () => this.teardownPeer(peerId, "channel-closed");
  }
  async handlePeerJoined(peerId) {
    if (typeof peerId !== "string" || peerId.length === 0 || peerId === this.localId) return;
    if (this.peers.has(peerId)) return;
    const pc = this.createPeerConnection(peerId);
    const reliable = pc.createDataChannel("reliable", { ordered: true });
    const unreliable = pc.createDataChannel("unreliable", { ordered: false, maxRetransmits: 0 });
    this.peers.set(peerId, { pc, reliable, unreliable, announced: false });
    this.setupDataChannels(peerId, reliable, unreliable);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signal({ type: "offer", target: peerId, sdp: offer });
  }
  async handleOffer(peerId, sdp) {
    if (typeof peerId !== "string" || peerId.length === 0 || peerId === this.localId) return;
    const existing = this.peers.get(peerId);
    if (existing) {
      if (this.localId < peerId) return;
      this.teardownPeer(
        peerId,
        "offer-collision",
        /* silent */
        true
      );
    }
    const pc = this.createPeerConnection(peerId);
    const entry = { pc, reliable: null, unreliable: null, announced: false };
    this.peers.set(peerId, entry);
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === "reliable") entry.reliable = channel;
      else if (channel.label === "unreliable") entry.unreliable = channel;
      if (entry.reliable && entry.unreliable) {
        this.setupDataChannels(peerId, entry.reliable, entry.unreliable);
      }
    };
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.signal({ type: "answer", target: peerId, sdp: answer });
  }
  async handleAnswer(peerId, sdp) {
    const peer = this.peers.get(peerId);
    if (peer) await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }
  async handleIceCandidate(peerId, candidate) {
    const peer = this.peers.get(peerId);
    if (peer) await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
  handlePeerLeft(peerId) {
    this.teardownPeer(peerId, "left");
  }
  /**
   * Close and forget a peer. Always closes the RTCPeerConnection, including when
   * the peer never finished negotiating — that path previously returned early and
   * leaked the connection while emitting nothing at all.
   */
  teardownPeer(peerId, _reason, silent = false) {
    this.clearHandshakeTimer(peerId);
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    if (peer.reliable) {
      this.sendQueues.delete(peer.reliable);
      try {
        peer.reliable.close();
      } catch {
      }
    }
    if (peer.unreliable) {
      this.sendQueues.delete(peer.unreliable);
      try {
        peer.unreliable.close();
      } catch {
      }
    }
    try {
      peer.pc.close();
    } catch {
    }
    if (!silent && peer.announced) this.emit("peer-left", peerId);
  }
  sendQueues = /* @__PURE__ */ new Map();
  /** Cap the per-channel backpressure queue so a stalled peer cannot exhaust memory. */
  static MAX_QUEUED_MESSAGES = 512;
  safeSend(dc, data) {
    if (!dc) return;
    try {
      if (dc.readyState !== "open") return;
      if (dc.bufferedAmount > 65536) {
        let queue = this.sendQueues.get(dc);
        if (!queue) {
          queue = [];
          this.sendQueues.set(dc, queue);
          dc.bufferedAmountLowThreshold = 16384;
          dc.addEventListener("bufferedamountlow", () => this.drainQueue(dc));
        }
        if (queue.length >= _NetworkManager.MAX_QUEUED_MESSAGES) {
          queue.shift();
        }
        queue.push(data);
        return;
      }
      dc.send(data);
    } catch {
    }
  }
  drainQueue(dc) {
    const queue = this.sendQueues.get(dc);
    if (!queue) return;
    while (queue.length > 0 && dc.bufferedAmount <= 65536) {
      const item = queue.shift();
      try {
        dc.send(item);
      } catch {
        break;
      }
    }
    if (queue.length === 0) this.sendQueues.delete(dc);
  }
  broadcastReliable(data) {
    for (const [, peer] of this.peers.entries()) this.safeSend(peer.reliable, data);
  }
  broadcastUnreliable(data) {
    for (const [, peer] of this.peers.entries()) this.safeSend(peer.unreliable, data);
  }
  sendTo(peerId, data, reliable) {
    const peer = this.peers.get(peerId);
    if (peer) this.safeSend(reliable ? peer.reliable : peer.unreliable, data);
  }
  /** True when the signalling socket is open. */
  get isConnected() {
    return this.connected;
  }
  disconnect() {
    this.connected = false;
    if (this.beforeUnloadHandler && typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("beforeunload", this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
      }
      this.ws = null;
    }
    for (const peerId of Array.from(this.peers.keys())) this.teardownPeer(peerId, "disconnect", true);
    for (const t of this.handshakeTimers.values()) clearTimeout(t);
    this.handshakeTimers.clear();
    this.peers.clear();
    this.sendQueues.clear();
  }
};

// src/matchmaker-client.ts
var DEFAULT_MATCHMAKER_TIMEOUT_MS = 1e4;
var MatchmakerClient = class {
  constructor(url, timeoutMs = DEFAULT_MATCHMAKER_TIMEOUT_MS) {
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
  url;
  timeoutMs;
  async createRoom() {
    const httpUrl = this.url.replace(/^ws(s?):\/\//, "http$1://");
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
    let res;
    try {
      res = await fetch(`${httpUrl}/api/rooms`, {
        method: "POST",
        ...controller ? { signal: controller.signal } : {}
      });
    } catch (err) {
      const e = err;
      if (e.name === "AbortError") {
        throw new Error(`SyncPlay: matchmaker at ${httpUrl} did not respond within ${this.timeoutMs}ms`);
      }
      throw new Error(`SyncPlay: matchmaker at ${httpUrl} is unreachable \u2014 ${e.message}`);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(
        `SyncPlay: matchmaker returned HTTP ${res.status} ${res.statusText} for POST ${httpUrl}/api/rooms`
      );
    }
    let data;
    try {
      data = await res.json();
    } catch (err) {
      throw new Error(`SyncPlay: matchmaker response was not JSON \u2014 ${err.message}`);
    }
    if (data === null || typeof data !== "object" || typeof data.roomId !== "string" || data.roomId.length === 0) {
      throw new Error(
        `SyncPlay: matchmaker response is missing a non-empty string "roomId" (got ${JSON.stringify(data)})`
      );
    }
    return data.roomId;
  }
};

// src/syncplay.ts
function generatePlayerId() {
  const g = globalThis;
  const bytes = new Uint8Array(16);
  if (g.crypto && typeof g.crypto.getRandomValues === "function") {
    g.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}
var SyncPlay = class extends EventEmitter {
  matchmaker;
  stateManager;
  networkManager;
  room = null;
  matchmakerUrl;
  options;
  _playerId = generatePlayerId();
  _playerCount = 1;
  _isHost = true;
  constructor(matchmakerUrl, options) {
    super();
    if (typeof matchmakerUrl !== "string" || matchmakerUrl.length === 0) {
      throw new TypeError(
        `SyncPlay: the first argument must be the matchmaker URL string, e.g. new SyncPlay("wss://match.example.com", { tickRate: 20 }) \u2014 got ${JSON.stringify(matchmakerUrl)}`
      );
    }
    LicenseValidator.validate(options);
    this.options = options ?? {};
    this.matchmakerUrl = matchmakerUrl;
    this.matchmaker = new MatchmakerClient(
      matchmakerUrl,
      this.options.matchmakerTimeoutMs ?? DEFAULT_MATCHMAKER_TIMEOUT_MS
    );
    this.stateManager = new StateManager();
    this.networkManager = new NetworkManager(
      this.options.iceServers,
      this.options.signalingTimeoutMs ?? DEFAULT_SIGNALING_TIMEOUT_MS,
      this.options.peerHandshakeTimeoutMs ?? DEFAULT_PEER_HANDSHAKE_TIMEOUT_MS
    );
    this.networkManager.on("error", (err) => this.emit("error", err));
    this.networkManager.on("peer-failed", (err) => this.emit("peer-failed", err));
    this.networkManager.on("signaling-closed", (err) => this.emit("signaling-closed", err));
  }
  attachRoom(id) {
    if (this.room) this.room.destroy();
    const room = new Room(
      id,
      this._playerId,
      this.networkManager,
      this.stateManager,
      this.options.maxPlayers ?? Infinity
    );
    this.room = room;
    room.on("host-changed", (newHostId) => {
      this._isHost = newHostId === this._playerId;
      this.emit("host-changed", newHostId);
    });
    for (const ev of [
      "peer-joined",
      "peer-left",
      "state-update",
      "tick",
      "host-migrated",
      "patches-dropped",
      "peer-rejected",
      "patches-rejected",
      "message-rejected"
    ]) {
      room.on(ev, (...args) => this.emit(ev, ...args));
    }
    if (this.options.autoStartGameLoop !== false) {
      room.startGameLoop(this.options.tickRate ?? 20);
    }
    return room;
  }
  async createRoom(roomId) {
    let id;
    try {
      id = roomId || await this.matchmaker.createRoom();
    } catch (err) {
      throw new Error(`SyncPlay: Failed to create room \u2014 ${err.message || "matchmaker unreachable"}`);
    }
    await this.networkManager.connect(this.matchmakerUrl, id, this._playerId);
    const room = this.attachRoom(id);
    this._isHost = true;
    return room;
  }
  async joinRoom(roomId) {
    if (typeof roomId !== "string" || roomId.length === 0) {
      throw new TypeError(`SyncPlay: joinRoom(roomId) requires a non-empty string, got ${JSON.stringify(roomId)}`);
    }
    await this.networkManager.connect(this.matchmakerUrl, roomId, this._playerId);
    return this.attachRoom(roomId);
  }
  async leaveRoom() {
    if (this.room) {
      this.room.destroy();
      this.room = null;
    }
    this.networkManager.disconnect();
  }
  /**
   * Set local game state and queue a delta for the next tick.
   * Returns false when the path was rejected (non-string, empty, or containing a
   * prototype-polluting segment such as `__proto__`).
   */
  setState(path, value) {
    return this.stateManager.setState(path, value);
  }
  getState(path) {
    return this.stateManager.getState(path);
  }
  get playerId() {
    return this._playerId;
  }
  get playerCount() {
    return this.room ? this.room.peers.length : 1;
  }
  get isHost() {
    return this.room ? this.room.hostId === this._playerId : this._isHost;
  }
};

// src/interpolator.ts
var Interpolator = class _Interpolator {
  static lerp(start, end, t) {
    return start + (end - start) * Math.max(0, Math.min(1, t));
  }
  /**
   * Static form. Every published example (README, llms.txt, llms-full.txt) calls
   * `Interpolator.interpolatePosition(...)` without constructing an instance,
   * so the static overload is the documented entry point.
   */
  static interpolatePosition(currentPos, targetPos, t) {
    return {
      x: _Interpolator.lerp(currentPos.x, targetPos.x, t),
      y: _Interpolator.lerp(currentPos.y, targetPos.y, t)
    };
  }
  /** Instance form, kept so existing `new Interpolator()` callers keep working. */
  interpolatePosition(currentPos, targetPos, t) {
    return _Interpolator.interpolatePosition(currentPos, targetPos, t);
  }
};
export {
  EventEmitter,
  Interpolator,
  MAX_PENDING_PATCHES,
  MatchmakerClient,
  NetworkManager,
  Room,
  StateManager,
  SyncPlay,
  SyncPlayNetworkError
};
//# sourceMappingURL=index.mjs.map