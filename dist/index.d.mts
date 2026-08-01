type EventCallback = (...args: any[]) => void;
declare class EventEmitter {
    private listeners;
    on(event: string, cb: EventCallback): this;
    /** Remove a single listener. Required to unsubscribe a Room on leaveRoom(). */
    off(event: string, cb: EventCallback): this;
    /** Remove every listener for one event, or all events when omitted. */
    removeAllListeners(event?: string): this;
    listenerCount(event: string): number;
    emit(event: string, ...args: any[]): boolean;
}

/** Error thrown/emitted for every signalling and ICE failure. */
declare class SyncPlayNetworkError extends Error {
    readonly code: 'signaling-timeout' | 'signaling-error' | 'signaling-closed' | 'peer-handshake-timeout' | 'ice-failed';
    readonly peerId?: string;
    constructor(code: SyncPlayNetworkError['code'], message: string, peerId?: string);
}
declare class NetworkManager extends EventEmitter {
    private iceServers;
    private signalingTimeoutMs;
    private peerHandshakeTimeoutMs;
    private peers;
    private handshakeTimers;
    private ws;
    private localId;
    private connected;
    private beforeUnloadHandler;
    constructor(iceServers?: RTCIceServer[], signalingTimeoutMs?: number, peerHandshakeTimeoutMs?: number);
    connect(signalingUrl: string, roomId: string, playerId: string): Promise<void>;
    private dispatch;
    /** Send on the signalling socket only when it is actually open. */
    private signal;
    private createPeerConnection;
    private clearHandshakeTimer;
    private setupDataChannels;
    private handlePeerJoined;
    private handleOffer;
    private handleAnswer;
    private handleIceCandidate;
    private handlePeerLeft;
    /**
     * Close and forget a peer. Always closes the RTCPeerConnection, including when
     * the peer never finished negotiating — that path previously returned early and
     * leaked the connection while emitting nothing at all.
     */
    private teardownPeer;
    private sendQueues;
    /** Cap the per-channel backpressure queue so a stalled peer cannot exhaust memory. */
    static readonly MAX_QUEUED_MESSAGES = 512;
    private safeSend;
    private drainQueue;
    broadcastReliable(data: ArrayBuffer | string): void;
    broadcastUnreliable(data: ArrayBuffer | string): void;
    sendTo(peerId: string, data: ArrayBuffer | string, reliable: boolean): void;
    /** True when the signalling socket is open. */
    get isConnected(): boolean;
    disconnect(): void;
}

/**
 * A single state delta.
 *
 * NOTE: only `add`, `replace` and `remove` are implemented. `move`, `copy` and
 * `test` are part of RFC 6902 but are rejected by StateManager (they emit
 * `patch_rejected`) rather than silently doing nothing.
 */
interface StatePatch {
    op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
    path: string;
    value?: any;
    from?: string;
}
interface SyncPlayOptions {
    /** Hard cap on players in a room, local host included. Default: unlimited. */
    maxPlayers?: number;
    /** Patch-flush frequency in Hz for the room game loop. Default: 20. */
    tickRate?: number;
    /**
     * ICE servers for every peer connection. Defaults to public STUN only, which
     * cannot traverse symmetric or carrier-grade NAT — supply a TURN entry here if
     * you need connectivity across arbitrary networks.
     */
    iceServers?: RTCIceServer[];
    /** Milliseconds to wait for the signalling socket to open. Default: 15000. */
    signalingTimeoutMs?: number;
    /** Milliseconds to wait for a peer's WebRTC handshake. Default: 20000. */
    peerHandshakeTimeoutMs?: number;
    /** Milliseconds to wait for the matchmaker HTTP call. Default: 10000. */
    matchmakerTimeoutMs?: number;
    /** Start the room game loop automatically on createRoom/joinRoom. Default: true. */
    autoStartGameLoop?: boolean;
    /** Commercial license key. Read from COMMERCIAL_LICENSE_KEY when omitted. */
    licenseKey?: string;
    /** Skip the license check for evaluation. */
    allowEval?: boolean;
}

declare class StateManager extends EventEmitter {
    private state;
    /**
     * Split and validate a JSON Pointer path. Returns null when the path is
     * unusable (wrong type, empty, or containing a prototype-polluting segment).
     * Never throws.
     */
    private parsePath;
    /**
     * Apply a single patch to the local state tree.
     *
     * Returns true when the patch was applied and false when it was rejected.
     * Rejections are reported via the `patch_rejected` event instead of throwing,
     * so a single bad patch cannot abort the remainder of an inbound batch.
     */
    applyPatch(patch: StatePatch): boolean;
    /** Returns true when the value was stored, false when the path was rejected. */
    setState(path: string, value: any): boolean;
    getState(path?: string): any;
}

/**
 * Upper bound on patches buffered between ticks. Without a cap, an application
 * that never starts the game loop grows this array without limit.
 */
declare const MAX_PENDING_PATCHES = 10000;
declare class Room extends EventEmitter {
    id: string;
    localPlayerId: string;
    private network;
    private stateManager;
    private maxPlayers;
    private loopInterval;
    private pendingPatches;
    private droppedPatches;
    /** Listeners this Room installed on shared objects, so they can be removed. */
    private subscriptions;
    peers: string[];
    hostId: string;
    constructor(id: string, localPlayerId: string, network: NetworkManager, stateManager: StateManager, maxPlayers?: number);
    private subscribe;
    /**
     * Detach every listener this Room installed on the shared NetworkManager and
     * StateManager. Without this, each createRoom()/joinRoom() left its listeners
     * attached, so one inbound message was applied once per historical Room.
     */
    destroy(): void;
    private evaluateHost;
    get isHost(): boolean;
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
    private options;
    _playerId: string;
    _playerCount: number;
    _isHost: boolean;
    constructor(matchmakerUrl: string, options?: SyncPlayOptions);
    private attachRoom;
    createRoom(roomId?: string): Promise<Room>;
    joinRoom(roomId: string): Promise<Room>;
    leaveRoom(): Promise<void>;
    /**
     * Set local game state and queue a delta for the next tick.
     * Returns false when the path was rejected (non-string, empty, or containing a
     * prototype-polluting segment such as `__proto__`).
     */
    setState(path: string, value: any): boolean;
    getState(path?: string): any;
    get playerId(): string;
    get playerCount(): number;
    get isHost(): boolean;
}

interface Vec2 {
    x: number;
    y: number;
}
declare class Interpolator {
    static lerp(start: number, end: number, t: number): number;
    /**
     * Static form. Every published example (README, llms.txt, llms-full.txt) calls
     * `Interpolator.interpolatePosition(...)` without constructing an instance,
     * so the static overload is the documented entry point.
     */
    static interpolatePosition(currentPos: Vec2, targetPos: Vec2, t: number): Vec2;
    /** Instance form, kept so existing `new Interpolator()` callers keep working. */
    interpolatePosition(currentPos: Vec2, targetPos: Vec2, t: number): Vec2;
}

declare class MatchmakerClient {
    private url;
    private timeoutMs;
    constructor(url: string, timeoutMs?: number);
    createRoom(): Promise<string>;
}

export { type EventCallback, EventEmitter, Interpolator, MAX_PENDING_PATCHES, MatchmakerClient, NetworkManager, Room, StateManager, type StatePatch, SyncPlay, SyncPlayNetworkError, type SyncPlayOptions, type Vec2 };
