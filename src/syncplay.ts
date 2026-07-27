// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com | +91 7031648617

import { LicenseValidator } from "./license-validator";
import { Room } from './room';
import { StateManager } from './state-manager';
import { NetworkManager } from './network-manager';
import { MatchmakerClient } from './matchmaker-client';
import { SyncPlayOptions, StatePatch } from './types';
import { EventEmitter } from './events';

export class SyncPlay extends EventEmitter {
  private matchmaker: MatchmakerClient;
  private stateManager: StateManager;
  private networkManager: NetworkManager;
  public room: Room | null = null;
  private matchmakerUrl: string;
  
  public _playerId: string = Math.random().toString(36).substring(7);
  public _playerCount: number = 1;
  public _isHost: boolean = true;

  constructor(matchmakerUrl: string, options?: SyncPlayOptions) {
    super();
    LicenseValidator.validate(options as any);
    this.matchmakerUrl = matchmakerUrl;
    this.matchmaker = new MatchmakerClient(matchmakerUrl);
    this.stateManager = new StateManager();
    this.networkManager = new NetworkManager();
  }

  async createRoom(roomId?: string): Promise<Room> {
    let id: string;
    try {
      id = roomId || await this.matchmaker.createRoom();
    } catch (err) {
      throw new Error(`SyncPlay: Failed to create room — ${(err as Error).message || 'matchmaker unreachable'}`);
    }
    await this.networkManager.connect(this.matchmakerUrl, id, this._playerId);
    
    this.room = new Room(id, this._playerId, this.networkManager, this.stateManager);
    this._isHost = true;
    return this.room;
  }

  async joinRoom(roomId: string): Promise<Room> {
    await this.networkManager.connect(this.matchmakerUrl, roomId, this._playerId);
    
    this.room = new Room(roomId, this._playerId, this.networkManager, this.stateManager);
    this.room.on('host-migrated', (newHostId: string) => {
      this._isHost = (newHostId === this._playerId);
    });
    
    return this.room;
  }

  async leaveRoom(): Promise<void> {
    if (this.room) {
      this.room.stopGameLoop();
    }
    this.networkManager.disconnect();
    this.room = null;
  }

  setState(path: string, value: any): void {
    this.stateManager.setState(path, value);
  }

  getState(path?: string): any {
    return this.stateManager.getState(path);
  }

  get playerId(): string { return this._playerId; }
  get playerCount(): number { return this.room ? this.room.peers.length : 1; }
  get isHost(): boolean { return this.room ? this.room.hostId === this._playerId : this._isHost; }
}
