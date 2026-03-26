// service_a/main.go - HTTP 클라이언트
//
// 역할: service_b 의 /ping 에 1초마다 HTTP GET 요청
// 목적: MicroTrace 가 TCP 연결/재전송을 추적할 수 있도록 트래픽 발생

package main

import (
	"fmt"
	"log"
	"net/http"
	"time"
)

const target = "http://localhost:8080/ping"

func main() {
	// DisableKeepAlives: true → 매 요청마다 새 TCP 연결
	// false(기본값)       → Keep-Alive로 연결 재사용
	//
	// true 로 설정한 이유:
	//   MicroTrace 현재 버전은 tcp_connect kprobe로 새 연결만 감지함.
	//   Keep-Alive 연결 재사용은 tcp_connect 를 호출하지 않아서 안 잡힘.
	//   → 일단 true 로 해서 매번 연결이 잡히는지 확인.
	//   → 이후 false 로 바꿔서 Keep-Alive 연결이 안 잡히는지도 확인.
	client := &http.Client{
		Transport: &http.Transport{
			DisableKeepAlives: false,
		},
		Timeout: 3 * time.Second,
	}

	log.Printf("[A] 시작: %s 로 1초마다 요청", target)

	for {
		start := time.Now()
		resp, err := client.Get(target)
		elapsed := time.Since(start)

		if err != nil {
			log.Printf("[A] 요청 실패: %v", err)
		} else {
			resp.Body.Close()
			fmt.Printf("[A] 응답: %s  걸린 시간: %v\n", resp.Status, elapsed)
		}

		time.Sleep(1 * time.Second)
	}
}
