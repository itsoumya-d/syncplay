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
        const msg = JSON.parse(event.data);
        
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
    });
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
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
    if (peer) {
      peer.reliable.close();
      peer.unreliable.close();
      peer.pc.close();
      this.peers.delete(peerId);
      this.emit('peer-left', peerId);
    }
  }

  broadcastReliable(data: ArrayBuffer | string) {
    for (const [peerId, peer] of this.peers.entries()) {
      if (peer.reliable.readyState === 'open') {
        peer.reliable.send(data as any);
      }
    }
  }

  broadcastUnreliable(data: ArrayBuffer | string) {
    for (const [peerId, peer] of this.peers.entries()) {
      if (peer.unreliable.readyState === 'open') {
        peer.unreliable.send(data as any);
      }
    }
  }

  sendTo(peerId: string, data: ArrayBuffer | string, reliable: boolean) {
    const peer = this.peers.get(peerId);
    if (peer) {
      const channel = reliable ? peer.reliable : peer.unreliable;
      if (channel.readyState === 'open') {
        channel.send(data as any);
      }
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
