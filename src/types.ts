// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com

/**
 * A single state delta.
 *
 * NOTE: only `add`, `replace` and `remove` are implemented. `move`, `copy` and
 * `test` are part of RFC 6902 but are rejected by StateManager (they emit
 * `patch_rejected`) rather than silently doing nothing.
 */
export interface StatePatch {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: any;
  from?: string;
}

export interface SyncPlayOptions {
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
