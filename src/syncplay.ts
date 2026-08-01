// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com

import { LicenseValidator } from './license-validator';
import { Room } from './room';
import { StateManager } from './state-manager';
import { NetworkManager, DEFAULT_SIGNALING_TIMEOUT_MS, DEFAULT_PEER_HANDSHAKE_TIMEOUT_MS } from './network-manager';
import { MatchmakerClient, DEFAULT_MATCHMAKER_TIMEOUT_MS } from './matchmaker-client';
import { SyncPlayOptions } from './types';
import { EventEmitter } from './events';

/**
 * Generate a collision-resistant player id.
 *
 * The previous `Math.random().toString(36).substring(7)` produced 4-6 base36
 * characters (~21-31 bits) and collided 123 times in 400k samples. Host election
 * is a lexicographic sort over these ids, so collisions elect two hosts.
 */
function generatePlayerId(): string {
  const g: any = globalThis as any;
  const bytes = new Uint8Array(16);
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
    g.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export class SyncPlay extends EventEmitter {
  private matchmaker: MatchmakerClient;
  private stateManager: StateManager;
  private networkManager: NetworkManager;
  public room: Room | null = null;
  private matchmakerUrl: string;
  private options: SyncPlayOptions;

  public _playerId: string = generatePlayerId();
  public _playerCount: number = 1;
  public _isHost: boolean = true;

  constructor(matchmakerUrl: string, options?: SyncPlayOptions) {
    super();
    if (typeof matchmakerUrl !== 'string' || matchmakerUrl.length === 0) {
      throw new TypeError(
        'SyncPlay: the first argument must be the matchmaker URL string, ' +
        `e.g. new SyncPlay("wss://match.example.com", { tickRate: 20 }) — got ${JSON.stringify(matchmakerUrl)}`
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
    // Previously the options object was passed to the license validator and then
    // discarded, so iceServers / timeouts / tickRate / maxPlayers were all ignored.
    this.networkManager = new NetworkManager(
      this.options.iceServers,
      this.options.signalingTimeoutMs ?? DEFAULT_SIGNALING_TIMEOUT_MS,
      this.options.peerHandshakeTimeoutMs ?? DEFAULT_PEER_HANDSHAKE_TIMEOUT_MS
    );
    // Forward transport diagnostics so `engine.on('error', ...)` works.
    this.networkManager.on('error', (err: Error) => this.emit('error', err));
    this.networkManager.on('peer-failed', (err: Error) => this.emit('peer-failed', err));
    this.networkManager.on('signaling-closed', (err: Error) => this.emit('signaling-closed', err));
  }

  private attachRoom(id: string): Room {
    // Tear the previous room down first. Without this every join left its
    // listeners on the shared NetworkManager/StateManager, so a single inbound
    // message was applied once per historical room.
    if (this.room) this.room.destroy();

    const room = new Room(
      id,
      this._playerId,
      this.networkManager,
      this.stateManager,
      this.options.maxPlayers ?? Infinity
    );
    this.room = room;

    // Previously registered only in joinRoom(), so a host that lost and regained
    // authority never updated _isHost.
    room.on('host-changed', (newHostId: string) => {
      this._isHost = (newHostId === this._playerId);
      this.emit('host-changed', newHostId);
    });
    // 'error', 'peer-failed' and 'signaling-closed' are forwarded from the
    // NetworkManager in the constructor, so they are deliberately not repeated
    // here — re-forwarding them via the Room would emit each one twice.
    for (const ev of ['peer-joined', 'peer-left', 'state-update', 'tick',
                      'host-migrated', 'patches-dropped', 'peer-rejected',
                      'patches-rejected', 'message-rejected'] as const) {
      room.on(ev, (...args: any[]) => this.emit(ev, ...args));
    }

    if (this.options.autoStartGameLoop !== false) {
      // Nothing was ever broadcast before unless the application reached into the
      // undocumented `engine.room.startGameLoop()`, so setState() was local-only.
      room.startGameLoop(this.options.tickRate ?? 20);
    }
    return room;
  }

  async createRoom(roomId?: string): Promise<Room> {
    let id: string;
    try {
      id = roomId || await this.matchmaker.createRoom();
    } catch (err) {
      throw new Error(`SyncPlay: Failed to create room — ${(err as Error).message || 'matchmaker unreachable'}`);
    }
    await this.networkManager.connect(this.matchmakerUrl, id, this._playerId);
    const room = this.attachRoom(id);
    this._isHost = true;
    return room;
  }

  async joinRoom(roomId: string): Promise<Room> {
    if (typeof roomId !== 'string' || roomId.length === 0) {
      throw new TypeError(`SyncPlay: joinRoom(roomId) requires a non-empty string, got ${JSON.stringify(roomId)}`);
    }
    await this.networkManager.connect(this.matchmakerUrl, roomId, this._playerId);
    return this.attachRoom(roomId);
  }

  async leaveRoom(): Promise<void> {
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
  setState(path: string, value: any): boolean {
    return this.stateManager.setState(path, value);
  }

  getState(path?: string): any {
    return this.stateManager.getState(path);
  }

  get playerId(): string { return this._playerId; }
  get playerCount(): number { return this.room ? this.room.peers.length : 1; }
  get isHost(): boolean { return this.room ? this.room.hostId === this._playerId : this._isHost; }
}
