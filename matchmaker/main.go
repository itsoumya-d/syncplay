// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1619@gmail.com

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
