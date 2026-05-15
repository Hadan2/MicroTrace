// collector/resource/provider.go
//
// ResourceProvider 인터페이스 — 자원 스냅샷을 공급하는 방법을 격리한다.
//
// 현재 구현: SubprocessProvider (resource_agent 바이너리를 subprocess로 실행)
// 미래 구현: RemoteProvider (EC2 멀티호스트 환경, gRPC로 수신)
//
// 호출 측(collector/main.go)은 이 인터페이스만 보고, 구현체가 무엇인지 몰라야 한다.

package resource

import (
	"context"

	"microtrace/collector/model"
)

// ResourceProvider — 컨테이너별 자원 스냅샷을 채널로 공급하는 인터페이스.
//
// Start: ctx가 취소되거나 소스가 종료되면 반환된 채널이 닫힌다.
// 호출자는 채널이 닫혔을 때 재시작 여부를 결정한다.
type ResourceProvider interface {
	Start(ctx context.Context) (<-chan model.ResourceSnapshot, error)
}
