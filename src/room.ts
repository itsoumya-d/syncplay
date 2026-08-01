// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com

import { EventEmitter, EventCallback } from './events';
import { NetworkManager } from './network-manager';
import { StateManager } from './state-manager';
import { StatePatch } from './types';

/**
 * Upper bound on patches buffered between ticks. Without a cap, an application
 * that never starts the game loop grows this array without limit.
 */
export const MAX_PENDING_PATCHES = 10000;

export class Room extends EventEmitter {
  private loopInterval: ReturnType<typeof setInterval> | null = null;
  private pendingPatches: StatePatch[] = [];
  private droppedPatches = 0;
  /** Listeners this Room installed on shared objects, so they can be removed. */
  private subscriptions: Array<[EventEmitter, string, EventCallback]> = [];
  public peers: string[] = [];
  public hostId: string;

  constructor(
    public id: string,
    public localPlayerId: string,
    private network: NetworkManager,
    private stateManager: StateManager,
    private maxPlayers: number = Infinity
  ) {
    super();
    this.hostId = localPlayerId;
    this.peers.push(localPlayerId);

    this.subscribe(this.network, 'peer-connected', (peerId: string) => {
      // Dedup: a re-announced peer used to be pushed twice, inflating
      // playerCount and letting one 'peer-left' remove both entries.
      if (this.peers.includes(peerId)) return;
      if (this.peers.length >= this.maxPlayers) {
        this.emit('peer-rejected', { peerId, reason: 'room-full', maxPlayers: this.maxPlayers });
        return;
      }
      this.peers.push(peerId);
      this.peers.sort();
      this.evaluateHost();
      this.emit('peer-joined', peerId);
    });

    this.subscribe(this.network, 'peer-left', (peerId: string) => {
      this.peers = this.peers.filter(p => p !== peerId);
      this.evaluateHost();
      this.emit('peer-left', peerId);
    });

    // ICE failure is a distinct condition from a voluntary departure. Forward it
    // so callers can tell "unreachable network / no TURN relay" apart from
    // "player quit" instead of seeing an identical 'peer-left'.
    this.subscribe(this.network, 'peer-failed', (err: Error) => this.emit('peer-failed', err));
    this.subscribe(this.network, 'signaling-closed', (err: Error) => this.emit('signaling-closed', err));
    this.subscribe(this.network, 'error', (err: Error) => this.emit('error', err));

    this.subscribe(this.network, 'message', (msg: { peerId: string, data: any, reliable: boolean }) => {
      let parsed: any;
      try {
        parsed = typeof msg.data === 'string'
          ? JSON.parse(msg.data)
          : JSON.parse(new TextDecoder().decode(msg.data as ArrayBuffer));
      } catch {
        this.emit('message-rejected', { peerId: msg.peerId, reason: 'unparseable' });
        return;
      }
      if (parsed === null || typeof parsed !== 'object') {
        this.emit('message-rejected', { peerId: msg.peerId, reason: 'not-an-object' });
        return;
      }
      if (parsed.type !== 'state-patch') return;
      if (!Array.isArray(parsed.patches)) {
        this.emit('message-rejected', { peerId: msg.peerId, reason: 'patches-not-an-array' });
        return;
      }
      // Apply each patch independently. Previously a single malformed patch threw
      // and silently discarded every remaining patch in the batch.
      const applied: StatePatch[] = [];
      const rejected: StatePatch[] = [];
      for (const patch of parsed.patches) {
        if (this.stateManager.applyPatch(patch)) applied.push(patch);
        else rejected.push(patch);
      }
      if (rejected.length > 0) {
        this.emit('patches-rejected', { peerId: msg.peerId, count: rejected.length, patches: rejected });
      }
      if (applied.length > 0) this.emit('state-update', applied);
    });

    this.subscribe(this.stateManager, 'patch_generated', (patch: StatePatch) => {
      if (this.pendingPatches.length >= MAX_PENDING_PATCHES) {
        this.pendingPatches.shift();
        this.droppedPatches++;
        if (this.droppedPatches === 1 || this.droppedPatches % 1000 === 0) {
          this.emit('patches-dropped', {
            total: this.droppedPatches,
            reason: this.loopInterval ? 'tick-rate-too-low' : 'game-loop-not-started',
          });
        }
      }
      this.pendingPatches.push(patch);
    });
  }

  private subscribe(target: EventEmitter, event: string, cb: EventCallback) {
    target.on(event, cb);
    this.subscriptions.push([target, event, cb]);
  }

  /**
   * Detach every listener this Room installed on the shared NetworkManager and
   * StateManager. Without this, each createRoom()/joinRoom() left its listeners
   * attached, so one inbound message was applied once per historical Room.
   */
  public destroy() {
    this.stopGameLoop();
    for (const [target, event, cb] of this.subscriptions) target.off(event, cb);
    this.subscriptions = [];
    this.removeAllListeners();
  }

  private evaluateHost() {
    if (this.peers.length === 0) return;
    const oldHost = this.hostId;
    this.hostId = this.peers[0];
    if (this.hostId !== oldHost) {
      this.emit('host-changed', this.hostId);
      if (this.hostId === this.localPlayerId) this.emit('host-migrated', this.localPlayerId);
    }
  }

  public get isHost(): boolean { return this.hostId === this.localPlayerId; }

  public startGameLoop(tickRate: number = 20) {
    if (!Number.isFinite(tickRate) || tickRate <= 0) {
      throw new RangeError(`SyncPlay: tickRate must be a positive finite number, got ${tickRate}`);
    }
    if (this.loopInterval) clearInterval(this.loopInterval);
    const tickMs = 1000 / tickRate;
    this.loopInterval = setInterval(() => {
      if (this.pendingPatches.length > 0) {
        const patches = this.pendingPatches;
        this.pendingPatches = [];
        // State deltas are cumulative: a dropped patch is never resent, so a lost
        // packet desyncs peers permanently. They therefore go on the reliable,
        // ordered channel — which is what the README and llms.txt already
        // documented. broadcastUnreliable() stays available for volatile data
        // such as rotation or cursor position.
        this.network.broadcastReliable(JSON.stringify({ type: 'state-patch', patches }));
      }
      this.emit('tick');
    }, tickMs);
  }

  public onStateUpdate(callback: (patches: StatePatch[]) => void) {
    this.on('state-update', callback);
  }

  public stopGameLoop() {
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
  }
}
