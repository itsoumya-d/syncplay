// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1619@gmail.com

import { EventEmitter } from './events';

interface PeerEntry {
  pc: RTCPeerConnection;
  reliable: RTCDataChannel | null;
  unreliable: RTCDataChannel | null;
  /** True once 'peer-connected' has been emitted for this peer. */
  announced: boolean;
}

/** Error thrown/emitted for every signalling and ICE failure. */
export class SyncPlayNetworkError extends Error {
  readonly code:
    | 'signaling-timeout'
    | 'signaling-error'
    | 'signaling-closed'
    | 'peer-handshake-timeout'
    | 'ice-failed';
  readonly peerId?: string;
  constructor(code: SyncPlayNetworkError['code'], message: string, peerId?: string) {
    super(message);
    this.name = 'SyncPlayNetworkError';
    this.code = code;
    this.peerId = peerId;
  }
}

/** How long to wait for the signalling socket to open before giving up. */
export const DEFAULT_SIGNALING_TIMEOUT_MS = 15000;
/** How long a peer may sit in negotiation before it is treated as unreachable. */
export const DEFAULT_PEER_HANDSHAKE_TIMEOUT_MS = 20000;

export class NetworkManager extends EventEmitter {
  private peers: Map<string, PeerEntry> = new Map();
  private handshakeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private ws: WebSocket | null = null;
  private localId: string = '';
  private connected = false;
  private beforeUnloadHandler: (() => void) | null = null;

  constructor(
    private iceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
    private signalingTimeoutMs: number = DEFAULT_SIGNALING_TIMEOUT_MS,
    private peerHandshakeTimeoutMs: number = DEFAULT_PEER_HANDSHAKE_TIMEOUT_MS
  ) {
    super();
  }

  async connect(signalingUrl: string, roomId: string, playerId: string): Promise<void> {
    this.localId = playerId;

    if (typeof roomId !== 'string' || roomId.length === 0) {
      throw new SyncPlayNetworkError('signaling-error', `SyncPlay: invalid roomId ${JSON.stringify(roomId)}`);
    }

    return new Promise<void>((resolve, reject) => {
      let wsUrl = signalingUrl;
      if (wsUrl.startsWith('http')) wsUrl = wsUrl.replace('http', 'ws');

      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (err?: Error) => {
        if (settled) return false;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        if (err) reject(err); else resolve();
        return true;
      };

      let ws: WebSocket;
      try {
        ws = new WebSocket(`${wsUrl}/ws/${encodeURIComponent(roomId)}/${encodeURIComponent(playerId)}`);
      } catch (err) {
        finish(new SyncPlayNetworkError('signaling-error',
          `SyncPlay: cannot open signalling socket to ${wsUrl} — ${(err as Error).message}`));
        return;
      }
      this.ws = ws;

      // Bound the connect attempt. Without this the promise settles only when the
      // platform's own TCP/handshake timeout fires, which is unbounded on some
      // mobile networks and differs across browsers.
      timer = setTimeout(() => {
        if (finish(new SyncPlayNetworkError('signaling-timeout',
          `SyncPlay: signalling server did not respond within ${this.signalingTimeoutMs}ms (${wsUrl})`))) {
          try { ws.close(); } catch { /* already closing */ }
        }
      }, this.signalingTimeoutMs);

      ws.onopen = () => {
        this.connected = true;
        finish();
      };

      ws.onerror = () => {
        // WebSocket 'error' events carry no useful detail by design, so build a
        // real Error rather than rejecting with a bare DOM Event.
        const err = new SyncPlayNetworkError('signaling-error',
          `SyncPlay: signalling connection to ${wsUrl} failed`);
        if (!finish(err)) this.emit('error', err);
      };

      // Previously unhandled: a socket that closes after opening left the caller
      // believing it was still connected forever.
      ws.onclose = (event: CloseEvent) => {
        const wasConnected = this.connected;
        this.connected = false;
        const err = new SyncPlayNetworkError('signaling-closed',
          `SyncPlay: signalling connection closed (code ${event?.code ?? 'unknown'})`);
        if (!finish(err) && wasConnected) {
          this.emit('signaling-closed', err);
          this.emit('error', err);
        }
      };

      ws.onmessage = (event) => {
        let msg: any;
        try {
          msg = JSON.parse(event.data);
        } catch {
          this.emit('error', new SyncPlayNetworkError('signaling-error',
            'SyncPlay: received malformed signalling message, ignoring'));
          return;
        }
        if (msg === null || typeof msg !== 'object' || typeof msg.type !== 'string') {
          this.emit('error', new SyncPlayNetworkError('signaling-error',
            'SyncPlay: signalling message missing a string "type", ignoring'));
          return;
        }
        // Dispatch is async; without this catch any rejected WebRTC step became
        // an unhandled promise rejection and the peer wedged with no diagnostic.
        this.dispatch(msg).catch((err) => {
          this.emit('error', new SyncPlayNetworkError('signaling-error',
            `SyncPlay: failed to handle "${msg.type}" from ${msg.peerId} — ${(err as Error).message}`,
            msg.peerId));
        });
      };

      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        this.beforeUnloadHandler = () => this.disconnect();
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
      }
    });
  }

  private async dispatch(msg: any): Promise<void> {
    switch (msg.type) {
      case 'peer-joined':      await this.handlePeerJoined(msg.peerId); break;
      case 'offer':            await this.handleOffer(msg.peerId, msg.sdp); break;
      case 'answer':           await this.handleAnswer(msg.peerId, msg.sdp); break;
      case 'ice-candidate':    await this.handleIceCandidate(msg.peerId, msg.candidate); break;
      case 'peer-left':        this.handlePeerLeft(msg.peerId); break;
      default: break;
    }
  }

  /** Send on the signalling socket only when it is actually open. */
  private signal(payload: unknown): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 /* OPEN */) return false;
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch (err) {
      this.emit('error', new SyncPlayNetworkError('signaling-error',
        `SyncPlay: failed to send on signalling socket — ${(err as Error).message}`));
      return false;
    }
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      // Guarded: trickled candidates arriving after the socket closed used to
      // throw an uncaught InvalidStateError out of this handler.
      this.signal({ type: 'ice-candidate', target: peerId, candidate: event.candidate });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        // 'failed' means ICE could not establish or has permanently broken —
        // usually symmetric/CGNAT with no TURN relay configured. This is NOT the
        // same thing as a player choosing to leave, so report it separately.
        this.emit('peer-failed', new SyncPlayNetworkError('ice-failed',
          `SyncPlay: ICE failed for peer ${peerId}. No TURN relay is configured by ` +
          `default, so symmetric and carrier-grade NAT cannot be traversed. ` +
          `Pass iceServers with a TURN entry to fix this.`, peerId));
        this.teardownPeer(peerId, 'ice-failed');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        this.teardownPeer(peerId, 'disconnected');
      } else if (pc.connectionState === 'connected') {
        this.clearHandshakeTimer(peerId);
      }
    };

    // Bound negotiation. Without this a peer whose handshake never completes
    // (partial datachannel delivery, silently dropped ICE) stayed invisible and
    // the RTCPeerConnection leaked with no event ever emitted.
    this.handshakeTimers.set(peerId, setTimeout(() => {
      const entry = this.peers.get(peerId);
      if (entry && entry.announced) return;
      this.emit('peer-failed', new SyncPlayNetworkError('peer-handshake-timeout',
        `SyncPlay: peer ${peerId} did not complete its WebRTC handshake within ` +
        `${this.peerHandshakeTimeoutMs}ms`, peerId));
      this.teardownPeer(peerId, 'handshake-timeout');
    }, this.peerHandshakeTimeoutMs));

    return pc;
  }

  private clearHandshakeTimer(peerId: string) {
    const t = this.handshakeTimers.get(peerId);
    if (t !== undefined) {
      clearTimeout(t);
      this.handshakeTimers.delete(peerId);
    }
  }

  private setupDataChannels(peerId: string, reliable: RTCDataChannel, unreliable: RTCDataChannel) {
    reliable.onmessage = (event) => this.emit('message', { peerId, data: event.data, reliable: true });
    unreliable.onmessage = (event) => this.emit('message', { peerId, data: event.data, reliable: false });

    const announce = () => {
      const entry = this.peers.get(peerId);
      if (!entry || entry.announced) return;
      if (reliable.readyState !== 'open') return;
      entry.announced = true;
      this.clearHandshakeTimer(peerId);
      this.emit('peer-connected', peerId);
    };

    reliable.onopen = announce;
    if (reliable.readyState === 'open') announce();
    reliable.onclose = () => this.teardownPeer(peerId, 'channel-closed');
  }

  private async handlePeerJoined(peerId: string) {
    if (typeof peerId !== 'string' || peerId.length === 0 || peerId === this.localId) return;
    // Re-announcement of a peer we already track would otherwise build a second
    // RTCPeerConnection and leak the first.
    if (this.peers.has(peerId)) return;

    const pc = this.createPeerConnection(peerId);
    const reliable = pc.createDataChannel('reliable', { ordered: true });
    const unreliable = pc.createDataChannel('unreliable', { ordered: false, maxRetransmits: 0 });

    this.peers.set(peerId, { pc, reliable, unreliable, announced: false });
    this.setupDataChannels(peerId, reliable, unreliable);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signal({ type: 'offer', target: peerId, sdp: offer });
  }

  private async handleOffer(peerId: string, sdp: RTCSessionDescriptionInit) {
    if (typeof peerId !== 'string' || peerId.length === 0 || peerId === this.localId) return;

    const existing = this.peers.get(peerId);
    if (existing) {
      // Offer collision (glare). Without a polite/impolite role we cannot run
      // perfect negotiation, so apply a deterministic tiebreak: the peer with
      // the lexicographically smaller id keeps its own offer and ignores the
      // incoming one. Previously both sides built a second RTCPeerConnection,
      // orphaning the first and leaving both peers unable to connect.
      if (this.localId < peerId) return;
      this.teardownPeer(peerId, 'offer-collision', /* silent */ true);
    }

    const pc = this.createPeerConnection(peerId);
    const entry: PeerEntry = { pc, reliable: null, unreliable: null, announced: false };
    this.peers.set(peerId, entry);

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === 'reliable') entry.reliable = channel;
      else if (channel.label === 'unreliable') entry.unreliable = channel;
      if (entry.reliable && entry.unreliable) {
        this.setupDataChannels(peerId, entry.reliable, entry.unreliable);
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.signal({ type: 'answer', target: peerId, sdp: answer });
  }

  private async handleAnswer(peerId: string, sdp: RTCSessionDescriptionInit) {
    const peer = this.peers.get(peerId);
    if (peer) await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  private async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(peerId);
    if (peer) await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  private handlePeerLeft(peerId: string) {
    this.teardownPeer(peerId, 'left');
  }

  /**
   * Close and forget a peer. Always closes the RTCPeerConnection, including when
   * the peer never finished negotiating — that path previously returned early and
   * leaked the connection while emitting nothing at all.
   */
  private teardownPeer(peerId: string, _reason: string, silent = false) {
    this.clearHandshakeTimer(peerId);
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    if (peer.reliable) { this.sendQueues.delete(peer.reliable); try { peer.reliable.close(); } catch { /* noop */ } }
    if (peer.unreliable) { this.sendQueues.delete(peer.unreliable); try { peer.unreliable.close(); } catch { /* noop */ } }
    try { peer.pc.close(); } catch { /* noop */ }
    if (!silent && peer.announced) this.emit('peer-left', peerId);
  }

  private sendQueues: Map<RTCDataChannel, Array<ArrayBuffer | string>> = new Map();
  /** Cap the per-channel backpressure queue so a stalled peer cannot exhaust memory. */
  static readonly MAX_QUEUED_MESSAGES = 512;

  private safeSend(dc: RTCDataChannel | null, data: ArrayBuffer | string) {
    if (!dc) return;
    try {
      if (dc.readyState !== 'open') return;
      if (dc.bufferedAmount > 65536) {
        let queue = this.sendQueues.get(dc);
        if (!queue) {
          queue = [];
          this.sendQueues.set(dc, queue);
          dc.bufferedAmountLowThreshold = 16384;
          dc.addEventListener('bufferedamountlow', () => this.drainQueue(dc));
        }
        if (queue.length >= NetworkManager.MAX_QUEUED_MESSAGES) {
          queue.shift();   // drop oldest; this data is superseded by the next tick
        }
        queue.push(data);
        return;
      }
      dc.send(data as any);
    } catch {
      // Channel closed between the readyState check and the send.
    }
  }

  private drainQueue(dc: RTCDataChannel) {
    const queue = this.sendQueues.get(dc);
    if (!queue) return;
    while (queue.length > 0 && dc.bufferedAmount <= 65536) {
      const item = queue.shift()!;
      try { dc.send(item as any); } catch { break; }
    }
    if (queue.length === 0) this.sendQueues.delete(dc);
  }

  broadcastReliable(data: ArrayBuffer | string) {
    for (const [, peer] of this.peers.entries()) this.safeSend(peer.reliable, data);
  }

  broadcastUnreliable(data: ArrayBuffer | string) {
    for (const [, peer] of this.peers.entries()) this.safeSend(peer.unreliable, data);
  }

  sendTo(peerId: string, data: ArrayBuffer | string, reliable: boolean) {
    const peer = this.peers.get(peerId);
    if (peer) this.safeSend(reliable ? peer.reliable : peer.unreliable, data);
  }

  /** True when the signalling socket is open. */
  get isConnected(): boolean { return this.connected; }

  disconnect() {
    this.connected = false;
    if (this.beforeUnloadHandler && typeof window !== 'undefined' &&
        typeof window.removeEventListener === 'function') {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.onmessage = null;
      try { this.ws.close(); } catch { /* noop */ }
      this.ws = null;
    }
    for (const peerId of Array.from(this.peers.keys())) this.teardownPeer(peerId, 'disconnect', true);
    for (const t of this.handshakeTimers.values()) clearTimeout(t);
    this.handshakeTimers.clear();
    this.peers.clear();
    this.sendQueues.clear();
  }
}
