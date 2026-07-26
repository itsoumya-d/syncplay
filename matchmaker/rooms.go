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
