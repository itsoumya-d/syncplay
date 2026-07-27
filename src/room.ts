// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com | +91 7031648617

import { EventEmitter } from './events';
import { NetworkManager } from './network-manager';
import { StateManager } from './state-manager';
import { StatePatch } from './types';

export class Room extends EventEmitter {
  private loopInterval: ReturnType<typeof setInterval> | null = null;
  private pendingPatches: StatePatch[] = [];
  public peers: string[] = [];
  public hostId: string;
  
  constructor(
    public id: string,
    public localPlayerId: string,
    private network: NetworkManager,
    private stateManager: StateManager
  ) {
    super();
    this.hostId = localPlayerId;
    this.peers.push(localPlayerId);
    
    this.network.on('peer-connected', (peerId: string) => {
      this.peers.push(peerId);
      this.peers.sort();
      this.evaluateHost();
      this.emit('peer-joined', peerId);
    });
    
    this.network.on('peer-left', (peerId: string) => {
      this.peers = this.peers.filter(p => p !== peerId);
      this.evaluateHost();
      this.emit('peer-left', peerId);
    });
    
    this.network.on('message', (msg: {peerId: string, data: any, reliable: boolean}) => {
      try {
        const parsed = typeof msg.data === 'string' ? JSON.parse(msg.data) : JSON.parse(new TextDecoder().decode(msg.data as ArrayBuffer));
        if (parsed.type === 'state-patch') {
          for (const patch of parsed.patches) {
            this.stateManager.applyPatch(patch);
          }
          this.emit('state-update', parsed.patches);
        }
      } catch (e) {
        // ignore
      }
    });

    this.stateManager.on('patch_generated', (patch: StatePatch) => {
      this.pendingPatches.push(patch);
    });
  }
  
  private evaluateHost() {
    if (this.peers.length > 0) {
      const oldHost = this.hostId;
      this.hostId = this.peers[0];
      if (this.hostId !== oldHost && this.hostId === this.localPlayerId) {
        this.emit('host-migrated', this.localPlayerId);
      }
    }
  }

  public startGameLoop(tickRate: number = 60) {
    if (this.loopInterval) clearInterval(this.loopInterval);
    
    const tickMs = 1000 / tickRate;
    this.loopInterval = setInterval(() => {
      if (this.pendingPatches.length > 0) {
         this.network.broadcastUnreliable(JSON.stringify({
            type: 'state-patch',
            patches: this.pendingPatches
         }));
         this.pendingPatches = [];
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
