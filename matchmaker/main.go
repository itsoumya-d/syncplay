package main

import (
	"log"
	"net/http"
)

func main() {
    http.HandleFunc("/api/rooms", handleCreateRoom)
    
    log.Println("Starting matchmaker on :8080")
    if err := http.ListenAndServe(":8080", nil); err != nil {
        log.Fatal(err)
    }
}
