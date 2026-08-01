type EventCallback = (...args: any[]) => void;
declare class EventEmitter {
    private listeners;
    on(event: string, cb: EventCallback): void;
    emit(event: string, ...args: any[]): void;
}

declare class NetworkManager extends EventEmitter {
    private peers;
    private ws;
    private localId;
    connect(signalingUrl: string, roomId: string, playerId: string): Promise<void>;
    private createPeerConnection;
    private setupDataChannels;
    private handlePeerJoined;
    private handleOffer;
    private handleAnswer;
    private handleIceCandidate;
    private handlePeerLeft;
    private sendQueues;
    private safeSend;
    private drainQueue;
    broadcastReliable(data: ArrayBuffer | string): void;
    broadcastUnreliable(data: ArrayBuffer | string): void;
    sendTo(peerId: string, data: ArrayBuffer | string, reliable: boolean): void;
    disconnect(): void;
}

interface StatePatch {
    op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
    path: string;
    value?: any;
    from?: string;
}
interface SyncPlayOptions {
    maxPlayers?: number;
    tickRate?: number;
}

declare class StateManager extends EventEmitter {
    private state;
    applyPatch(patch: StatePatch): void;
    setState(path: string, value: any): void;
    getState(path?: string): any;
}

declare class Room extends EventEmitter {
    id: string;
    localPlayerId: string;
    private network;
    private stateManager;
    private loopInterval;
    private pendingPatches;
    peers: string[];
    hostId: string;
    constructor(id: string, localPlayerId: string, network: NetworkManager, stateManager: StateManager);
    private evaluateHost;
    startGameLoop(tickRate?: number): void;
    onStateUpdate(callback: (patches: StatePatch[]) => void): void;
    stopGameLoop(): void;
}

declare class SyncPlay extends EventEmitter {
    private matchmaker;
    private stateManager;
    private networkManager;
    room: Room | null;
    private matchmakerUrl;
    _playerId: string;
    _playerCount: number;
    _isHost: boolean;
    constructor(matchmakerUrl: string, options?: SyncPlayOptions);
    createRoom(roomId?: string): Promise<Room>;
    joinRoom(roomId: string): Promise<Room>;
    leaveRoom(): Promise<void>;
    setState(path: string, value: any): void;
    getState(path?: string): any;
    get playerId(): string;
    get playerCount(): number;
    get isHost(): boolean;
}

export { type StatePatch, SyncPlay, type SyncPlayOptions };
