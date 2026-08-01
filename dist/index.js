"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  SyncPlay: () => SyncPlay
});
module.exports = __toCommonJS(index_exports);

// src/license-validator.ts
var LicenseValidator = class {
  static AUTHOR = "Soumya Debnath";
  static CONTACT = "soumyadebnath1661@gmail.com";
  static validate(options) {
    const key = options?.licenseKey || (typeof process !== "undefined" ? process.env.COMMERCIAL_LICENSE_KEY : void 0);
    const isDev = typeof window !== "undefined" ? window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" : typeof process !== "undefined" && process.env.NODE_ENV !== "production";
    if (isDev || options?.allowEval) {
      return true;
    }
    if (!key || !key.startsWith("BSL11-")) {
      console.warn(`
================================================================================
\u{1F512} COMMERCIAL USE WARNING \u2014 BUSINESS SOURCE LICENSE 1.1 REQUIRED
Product: SYNCPLAY | Copyright (c) 2024-2026 Soumya Debnath

Production use of this software requires a valid paid commercial license key.
Unlicensed commercial deployment constitutes copyright infringement under DMCA \xA7 1201.

Purchase a commercial license key:
\u{1F4E7} Email: soumyadebnath1661@gmail.com | \u{1F4DE} Phone: +91 7031648617
================================================================================
      `);
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
  }
  emit(event, ...args) {
    this.listeners.get(event)?.forEach((cb) => cb(...args));
  }
};

// src/room.ts
var Room = class extends EventEmitter {
  constructor(id, localPlayerId, network, stateManager) {
    super();
    this.id = id;
    this.localPlayerId = localPlayerId;
    this.network = network;
    this.stateManager = stateManager;
    this.hostId = localPlayerId;
    this.peers.push(localPlayerId);
    this.network.on("peer-connected", (peerId) => {
      this.peers.push(peerId);
      this.peers.sort();
      this.evaluateHost();
      this.emit("peer-joined", peerId);
    });
    this.network.on("peer-left", (peerId) => {
      this.peers = this.peers.filter((p) => p !== peerId);
      this.evaluateHost();
      this.emit("peer-left", peerId);
    });
    this.network.on("message", (msg) => {
      try {
        const parsed = typeof msg.data === "string" ? JSON.parse(msg.data) : JSON.parse(new TextDecoder().decode(msg.data));
        if (parsed.type === "state-patch") {
          for (const patch of parsed.patches) {
            this.stateManager.applyPatch(patch);
          }
          this.emit("state-update", parsed.patches);
        }
      } catch (e) {
      }
    });
    this.stateManager.on("patch_generated", (patch) => {
      this.pendingPatches.push(patch);
    });
  }
  id;
  localPlayerId;
  network;
  stateManager;
  loopInterval = null;
  pendingPatches = [];
  peers = [];
  hostId;
  evaluateHost() {
    if (this.peers.length > 0) {
      const oldHost = this.hostId;
      this.hostId = this.peers[0];
      if (this.hostId !== oldHost && this.hostId === this.localPlayerId) {
        this.emit("host-migrated", this.localPlayerId);
      }
    }
  }
  startGameLoop(tickRate = 60) {
    if (this.loopInterval) clearInterval(this.loopInterval);
    const tickMs = 1e3 / tickRate;
    this.loopInterval = setInterval(() => {
      if (this.pendingPatches.length > 0) {
        this.network.broadcastUnreliable(JSON.stringify({
          type: "state-patch",
          patches: this.pendingPatches
        }));
        this.pendingPatches = [];
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
var StateManager = class extends EventEmitter {
  state = {};
  applyPatch(patch) {
    const keys = patch.path.split("/").filter(Boolean);
    if (keys.length === 0) return;
    let current = this.state;
    for (let i = 0; i < keys.length - 1; i++) {
      if (current[keys[i]] === void 0) current[keys[i]] = {};
      current = current[keys[i]];
    }
    const lastKey = keys[keys.length - 1];
    if (patch.op === "replace" || patch.op === "add") {
      current[lastKey] = patch.value;
    } else if (patch.op === "remove") {
      delete current[lastKey];
    }
    this.emit("state_changed", this.state);
  }
  setState(path, value) {
    const patch = { op: "replace", path, value };
    this.applyPatch(patch);
    this.emit("patch_generated", patch);
  }
  getState(path) {
    if (!path) return this.state;
    const keys = path.split("/").filter(Boolean);
    let current = this.state;
    for (const key of keys) {
      if (current === void 0) return void 0;
      current = current[key];
    }
    return current;
  }
};

// src/network-manager.ts
var NetworkManager = class extends EventEmitter {
  peers = /* @__PURE__ */ new Map();
  ws = null;
  localId = "";
  async connect(signalingUrl, roomId, playerId) {
    this.localId = playerId;
    return new Promise((resolve, reject) => {
      let wsUrl = signalingUrl;
      if (wsUrl.startsWith("http")) wsUrl = wsUrl.replace("http", "ws");
      this.ws = new WebSocket(`${wsUrl}/ws/${roomId}/${playerId}`);
      this.ws.onopen = () => {
        resolve();
      };
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = async (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          console.warn("SyncPlay: Received malformed WebSocket message, ignoring");
          return;
        }
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
        }
      };
      if (typeof window !== "undefined") {
        window.addEventListener("beforeunload", () => this.disconnect());
      }
    });
  }
  createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" }
      ]
    });
    pc.onicecandidate = (event) => {
      if (event.candidate && this.ws) {
        this.ws.send(JSON.stringify({
          type: "ice-candidate",
          target: peerId,
          candidate: event.candidate
        }));
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        this.handlePeerLeft(peerId);
      }
    };
    return pc;
  }
  setupDataChannels(peerId, reliable, unreliable) {
    reliable.onmessage = (event) => this.emit("message", { peerId, data: event.data, reliable: true });
    unreliable.onmessage = (event) => this.emit("message", { peerId, data: event.data, reliable: false });
    reliable.onopen = () => {
      this.emit("peer-connected", peerId);
    };
    reliable.onclose = () => this.handlePeerLeft(peerId);
  }
  async handlePeerJoined(peerId) {
    const pc = this.createPeerConnection(peerId);
    const reliable = pc.createDataChannel("reliable", { ordered: true });
    const unreliable = pc.createDataChannel("unreliable", { ordered: false, maxRetransmits: 0 });
    this.peers.set(peerId, { pc, reliable, unreliable });
    this.setupDataChannels(peerId, reliable, unreliable);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (this.ws) {
      this.ws.send(JSON.stringify({
        type: "offer",
        target: peerId,
        sdp: offer
      }));
    }
  }
  async handleOffer(peerId, sdp) {
    const pc = this.createPeerConnection(peerId);
    let reliable = null;
    let unreliable = null;
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === "reliable") reliable = channel;
      else if (channel.label === "unreliable") unreliable = channel;
      if (reliable && unreliable) {
        this.peers.set(peerId, { pc, reliable, unreliable });
        this.setupDataChannels(peerId, reliable, unreliable);
      }
    };
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (this.ws) {
      this.ws.send(JSON.stringify({
        type: "answer",
        target: peerId,
        sdp: answer
      }));
    }
  }
  async handleAnswer(peerId, sdp) {
    const peer = this.peers.get(peerId);
    if (peer) {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
  }
  async handleIceCandidate(peerId, candidate) {
    const peer = this.peers.get(peerId);
    if (peer) {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }
  handlePeerLeft(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    try {
      peer.reliable.close();
    } catch {
    }
    try {
      peer.unreliable.close();
    } catch {
    }
    try {
      peer.pc.close();
    } catch {
    }
    this.emit("peer-left", peerId);
  }
  sendQueues = /* @__PURE__ */ new Map();
  safeSend(dc, data) {
    try {
      if (dc.readyState !== "open") return;
      if (dc.bufferedAmount > 65536) {
        let queue = this.sendQueues.get(dc);
        if (!queue) {
          queue = [];
          this.sendQueues.set(dc, queue);
          dc.bufferedAmountLowThreshold = 16384;
          dc.addEventListener("bufferedamountlow", () => {
            this.drainQueue(dc);
          });
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
    if (queue.length === 0) {
      this.sendQueues.delete(dc);
    }
  }
  broadcastReliable(data) {
    for (const [, peer] of this.peers.entries()) {
      this.safeSend(peer.reliable, data);
    }
  }
  broadcastUnreliable(data) {
    for (const [, peer] of this.peers.entries()) {
      this.safeSend(peer.unreliable, data);
    }
  }
  sendTo(peerId, data, reliable) {
    const peer = this.peers.get(peerId);
    if (peer) {
      this.safeSend(reliable ? peer.reliable : peer.unreliable, data);
    }
  }
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    for (const peerId of Array.from(this.peers.keys())) {
      this.handlePeerLeft(peerId);
    }
    this.peers.clear();
  }
};

// src/matchmaker-client.ts
var MatchmakerClient = class {
  constructor(url) {
    this.url = url;
  }
  url;
  async createRoom() {
    const res = await fetch(`${this.url}/api/rooms`, { method: "POST" });
    const data = await res.json();
    return data.roomId;
  }
};

// src/syncplay.ts
var SyncPlay = class extends EventEmitter {
  matchmaker;
  stateManager;
  networkManager;
  room = null;
  matchmakerUrl;
  _playerId = Math.random().toString(36).substring(7);
  _playerCount = 1;
  _isHost = true;
  constructor(matchmakerUrl, options) {
    super();
    LicenseValidator.validate(options);
    this.matchmakerUrl = matchmakerUrl;
    this.matchmaker = new MatchmakerClient(matchmakerUrl);
    this.stateManager = new StateManager();
    this.networkManager = new NetworkManager();
  }
  async createRoom(roomId) {
    let id;
    try {
      id = roomId || await this.matchmaker.createRoom();
    } catch (err) {
      throw new Error(`SyncPlay: Failed to create room \u2014 ${err.message || "matchmaker unreachable"}`);
    }
    await this.networkManager.connect(this.matchmakerUrl, id, this._playerId);
    this.room = new Room(id, this._playerId, this.networkManager, this.stateManager);
    this._isHost = true;
    return this.room;
  }
  async joinRoom(roomId) {
    await this.networkManager.connect(this.matchmakerUrl, roomId, this._playerId);
    this.room = new Room(roomId, this._playerId, this.networkManager, this.stateManager);
    this.room.on("host-migrated", (newHostId) => {
      this._isHost = newHostId === this._playerId;
    });
    return this.room;
  }
  async leaveRoom() {
    if (this.room) {
      this.room.stopGameLoop();
    }
    this.networkManager.disconnect();
    this.room = null;
  }
  setState(path, value) {
    this.stateManager.setState(path, value);
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SyncPlay
});
//# sourceMappingURL=index.js.map