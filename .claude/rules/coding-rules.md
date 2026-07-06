# 코딩 규칙 및 안티패턴 (microtrace)

> CLAUDE.md가 "필수 참조"로 가리키는 아키텍처·패턴·안티패턴. 코드 근거는 `microtrace.code.md`.

## 아키텍처/패턴

- **인터페이스로 변경 경계를 격리한다.** 교체가 예정된 구현체는 인터페이스 뒤에 숨긴다.
  호출 측(stats, hub)은 인터페이스만 보고, 구현체가 무엇인지 몰라야 한다.
  - `ServiceResolver` → `DockerResolver` / `StaticResolver` / `EnrichResolver`
  - `EventProvider` / `ResourceProvider` → `SubprocessProvider`(현재) / gRPC 구현체(EC2 단계)
- **패키지는 역할 단위로 나눈다.** `agent/`(이벤트 공급) · `resource/`(자원 공급) · `resolver/`(IP→이름) ·
  `stats/`(집계·spike·cause) · `hub/`(WebSocket) · `store/`(SQLite) · `model/`(공유 타입) · `main.go`(배선만).
- **통신 방식을 비즈니스 로직과 분리한다.** stats는 데이터가 파이프로 오는지 gRPC로 오는지 모른다.
  `chan model.Event` 하나만 받는다. gRPC로 전환해도 stats, hub는 건드리지 않는다.

## 언어별

### Go (collector, resource_agent)
- Idiomatic Go. 채널로 데이터 흐름 표현. 철저한 에러 처리.
- 고빈도 경로에서 lock 규약을 지킨다: 집계 계산은 한 lock 안에서, `broadcast`/`store`는 lock 밖에서(느린 hub가 집계를 막지 않게).

### eBPF (C)
- 리눅스 커널 코딩 스타일. CO-RE(Compile Once – Run Everywhere).
- Verifier 제약: 무한루프 금지, 메모리 범위 체크 필수.
- 종료 시 `bpf_prog_detach` 필수(안 하면 cgroup에 hook 잔류 → 다음 실행 attach 에러).

### Frontend (TypeScript/React)
- 함수형 컴포넌트. 고빈도 데이터는 Canvas 직접 렌더링(devicePixelRatio 적용).
- WebSocket 메시지 타입: `stats` / `event` / `resource` / `remove` / `history`.

## 안티패턴 ★AI가 하지 말 것★

> 실제로 코드에 존재하는 함정. 상세·근거는 `microtrace.code.md` §11.

1. **필드 하나만 고치기 금지.** 같은 데이터가 프로세스 경계마다 별도 struct로 중복 선언돼 있다.
   필드 추가 시 code map §1 "필드 전파 지도"의 관련 위치를 **전부 동시에** 고친다.
2. **`"src→dst"` 키 구분자(U+2192)를 바꾸지 말 것.** backend 3곳 + frontend가 이 문자열로 일치해야
   remove/history 매칭이 된다. 구분자 바꾸면 노드 제거·히스토리 머지가 조용히 깨진다.
3. **`struct event` 필드 순서를 바꾸지 말 것.** 크기 내림차순 배치로 clang(bpf.c)과 gcc(trace.c)가
   같은 레이아웃으로 읽는다. 순서 바꾸면 파싱이 깨진다.
4. **eBPF `jitter_us`를 "쓰이는 값"으로 착각 금지.** 커널이 계산·전송하지만 collector는 무시하고
   Go에서 mdev를 재계산한다(데드 데이터).
5. **`detectCause`는 `'io'`를 반환하지 않는다.** 프론트 타입에 `'io'`가 있어도 dead path다.

> 팁: 같은 실수를 AI가 두 번 하면, 그걸 여기 한 줄로 박아 세 번째를 막는다.
