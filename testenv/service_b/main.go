// service_b/main.go - HTTP 서버
//
// 역할: service_a 로부터 HTTP 요청을 받아서 응답
// 포트: 8080

package main

import (
	"fmt"
	"log"
	"net/http"
	"time"
)

func pingHandler(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "pong")
	log.Printf("[B] %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)
}

func main() {
	http.HandleFunc("/ping", pingHandler)

	log.Printf("[B] 서버 시작: http://localhost:8080")
	srv := &http.Server{
		Addr:        ":8080",
		ReadTimeout: 5 * time.Second,
		IdleTimeout: 60 * time.Second, // Keep-Alive 연결 60초 유지
	}
	log.Fatal(srv.ListenAndServe())
}
