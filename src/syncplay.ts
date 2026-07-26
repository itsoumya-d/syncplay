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
  
  public _playerId: string = Math.random().toString(36).substring(7);
  public _playerCount: number = 1;
  public _isHost: boolean = true;

  constructor(matchmakerUrl: string, options?: SyncPlayOptions) {
    super();
    this.matchmaker = new MatchmakerClient(matchmakerUrl);
    this.stateManager = new StateManager();
    this.networkManager = new NetworkManager();
  }

  async createRoom(roomId?: string): Promise<Room> {
    const id = roomId || await this.matchmaker.createRoom();
    return new Room(id);
  }

  async joinRoom(roomId: string): Promise<Room> {
    return new Room(roomId);
  }

  async leaveRoom(): Promise<void> {}

  setState(path: string, value: any): void {
    this.stateManager.setState(path, value);
  }

  getState(path?: string): any {
    return this.stateManager.getState(path);
  }

  get playerId(): string { return this._playerId; }
  get playerCount(): number { return this._playerCount; }
  get isHost(): boolean { return this._isHost; }
}
