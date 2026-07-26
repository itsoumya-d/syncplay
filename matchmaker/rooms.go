// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com | +91 7031648617

package main

import (
    "sync"
    "math/rand"
)

var rooms = make(map[string]*Room)
var roomsMutex sync.Mutex

func generateRoomID() string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    b := make([]byte, 6)
    for i := range b {
        b[i] = chars[rand.Intn(len(chars))]
    }
    return string(b)
}

func createRoom() string {
    roomsMutex.Lock()
    defer roomsMutex.Unlock()
    id := generateRoomID()
    rooms[id] = &Room{ID: id}
    return id
}
