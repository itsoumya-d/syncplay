// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com | +91 7031648617

import { EventEmitter } from './events';

interface PeerEntry {
  pc: RTCPeerConnection;
  reliable: RTCDataChannel;
  unreliable: RTCDataChannel;
}

export class NetworkManager extends EventEmitter {
  private peers: Map<string, PeerEntry> = new Map();
  private ws: WebSocket | null = null;
  private localId: string = "";
  
  async connect(signalingUrl: string, roomId: string, playerId: string) {
    this.localId = playerId;
    
    return new Promise<void>((resolve, reject) => {
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
          console.warn('SyncPlay: Received malformed WebSocket message, ignoring');
          return;
        }
        
        switch (msg.type) {
          case 'peer-joined':
            await this.handlePeerJoined(msg.peerId);
            break;
          case 'offer':
            await this.handleOffer(msg.peerId, msg.sdp);
            break;
          case 'answer':
            await this.handleAnswer(msg.peerId, msg.sdp);
            break;
          case 'ice-candidate':
            await this.handleIceCandidate(msg.peerId, msg.candidate);
            break;
          case 'peer-left':
            this.handlePeerLeft(msg.peerId);
            break;
        }
      };

      // Clean up on tab close to prevent zombie connections
      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', () => this.disconnect());
      }
    });
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && this.ws) {
        this.ws.send(JSON.stringify({
          type: 'ice-candidate',
          target: peerId,
          candidate: event.candidate
        }));
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.handlePeerLeft(peerId);
      }
    };

    return pc;
  }

  private setupDataChannels(peerId: string, reliable: RTCDataChannel, unreliable: RTCDataChannel) {
    reliable.onmessage = (event) => this.emit('message', { peerId, data: event.data, reliable: true });
    unreliable.onmessage = (event) => this.emit('message', { peerId, data: event.data, reliable: false });
    
    reliable.onopen = () => {
      this.emit('peer-connected', peerId);
    };
    
    reliable.onclose = () => this.handlePeerLeft(peerId);
  }

  private async handlePeerJoined(peerId: string) {
    const pc = this.createPeerConnection(peerId);
    const reliable = pc.createDataChannel('reliable', { ordered: true });
    const unreliable = pc.createDataChannel('unreliable', { ordered: false, maxRetransmits: 0 });
    
    this.peers.set(peerId, { pc, reliable, unreliable });
    this.setupDataChannels(peerId, reliable, unreliable);
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    if (this.ws) {
      this.ws.send(JSON.stringify({
        type: 'offer',
        target: peerId,
        sdp: offer
      }));
    }
  }

  private async handleOffer(peerId: string, sdp: RTCSessionDescriptionInit) {
    const pc = this.createPeerConnection(peerId);
    
    let reliable: RTCDataChannel | null = null;
    let unreliable: RTCDataChannel | null = null;
    
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === 'reliable') reliable = channel;
      else if (channel.label === 'unreliable') unreliable = channel;
      
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
        type: 'answer',
        target: peerId,
        sdp: answer
      }));
    }
  }

  private async handleAnswer(peerId: string, sdp: RTCSessionDescriptionInit) {
    const peer = this.peers.get(peerId);
    if (peer) {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
  }

  private async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(peerId);
    if (peer) {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  private handlePeerLeft(peerId: string) {
    const peer = this.peers.get(peerId);
    if (!peer) return; // Guard against double-fire
    this.peers.delete(peerId);
    try { peer.reliable.close(); } catch {}
    try { peer.unreliable.close(); } catch {}
    try { peer.pc.close(); } catch {}
    this.emit('peer-left', peerId);
  }

  private sendQueues: Map<RTCDataChannel, Array<ArrayBuffer | string>> = new Map();

  private safeSend(dc: RTCDataChannel, data: ArrayBuffer | string) {
    try {
      if (dc.readyState !== 'open') return;
      if (dc.bufferedAmount > 65536) {
        // Queue the message
        let queue = this.sendQueues.get(dc);
        if (!queue) {
          queue = [];
          this.sendQueues.set(dc, queue);
          dc.bufferedAmountLowThreshold = 16384;
          dc.addEventListener('bufferedamountlow', () => {
            this.drainQueue(dc);
          });
        }
        queue.push(data);
        return;
      }
      dc.send(data as any);
    } catch {
      // Channel closed between check and send
    }
  }

  private drainQueue(dc: RTCDataChannel) {
    const queue = this.sendQueues.get(dc);
    if (!queue) return;
    while (queue.length > 0 && dc.bufferedAmount <= 65536) {
      const item = queue.shift()!;
      try { dc.send(item as any); } catch { break; }
    }
    if (queue.length === 0) {
      this.sendQueues.delete(dc);
    }
  }

  broadcastReliable(data: ArrayBuffer | string) {
    for (const [, peer] of this.peers.entries()) {
      this.safeSend(peer.reliable, data);
    }
  }

  broadcastUnreliable(data: ArrayBuffer | string) {
    for (const [, peer] of this.peers.entries()) {
      this.safeSend(peer.unreliable, data);
    }
  }

  sendTo(peerId: string, data: ArrayBuffer | string, reliable: boolean) {
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
}
