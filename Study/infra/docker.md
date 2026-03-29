# Docker 기초

## Docker가 뭔지

> "내 컴퓨터에서는 되는데 서버에서는 안 돼요" 문제를 해결하는 기술

앱을 실행하려면 코드뿐만 아니라 언어 런타임, 라이브러리, 환경변수, OS 설정 등이 전부 맞아야 함.
Docker는 이 모든 것을 **컨테이너**라는 박스에 묶어서, 어디서든 똑같이 실행되게 해줌.

```
Docker 없을 때:
  개발자 PC (Ubuntu 22.04, Node 18) → 서버 (CentOS 7, Node 16) → 안 됨

Docker 있을 때:
  컨테이너 (Ubuntu 22.04, Node 18이 전부 들어있음) → 어디서든 똑같이 실행
```

---

## 핵심 개념 3가지

### 1. 이미지 (Image)
컨테이너를 만들기 위한 **설계도 (읽기 전용)**

```
이미지 = OS + 런타임 + 라이브러리 + 앱 코드
예시:
  node:18          → Node.js 18이 설치된 Ubuntu
  golang:1.22      → Go 1.22이 설치된 Debian
  nginx:latest     → Nginx 웹서버
```

도커 허브(hub.docker.com)에 공개된 이미지가 수십만 개 있어서 그냥 가져다 쓸 수 있음.

### 2. 컨테이너 (Container)
이미지를 **실제로 실행한 것 (프로세스)**

```
이미지 : 컨테이너 = 클래스 : 인스턴스 (객체지향 비유)
이미지 : 컨테이너 = 레시피 : 요리 (요리 비유)

같은 이미지로 컨테이너를 여러 개 만들 수 있음
```

### 3. Dockerfile
이미지를 **어떻게 만들지 작성하는 스크립트**

```dockerfile
# 베이스 이미지 (이미 만들어진 이미지에서 시작)
FROM golang:1.22

# 작업 디렉토리 설정
WORKDIR /app

# 소스코드 복사
COPY . .

# 빌드
RUN go build -o collector main.go

# 실행 명령
CMD ["./collector"]
```

---

## VM vs Docker

자주 헷갈리는 개념.

```
VM (Virtual Machine):
  ┌─────────────────────────┐
  │  앱                      │
  │  Guest OS (전체 OS)      │  ← 수 GB, 부팅 수분
  │  Hypervisor              │
  └─────────────────────────┘

Docker Container:
  ┌─────────────────────────┐
  │  앱                      │
  │  필요한 라이브러리만      │  ← 수 MB, 즉시 시작
  │  Host OS 커널 공유       │
  └─────────────────────────┘
```

| 항목 | VM | Docker |
|------|----|----|
| 크기 | 수 GB | 수 MB ~ 수백 MB |
| 시작 시간 | 수 분 | 수 초 이내 |
| 격리 수준 | 완전 격리 | 프로세스 수준 격리 |
| 오버헤드 | 높음 | 낮음 |

---

## 기본 명령어

```bash
# 이미지 다운로드
docker pull nginx

# 이미지 목록
docker images

# 컨테이너 실행
docker run nginx

# 컨테이너 실행 (백그라운드 + 포트 연결)
docker run -d -p 8080:80 nginx
#           │   └─ 호스트:컨테이너 포트 매핑
#           └─ 백그라운드 실행

# 실행 중인 컨테이너 목록
docker ps

# 모든 컨테이너 목록 (종료된 것 포함)
docker ps -a

# 컨테이너 중지
docker stop <컨테이너ID>

# 컨테이너 삭제
docker rm <컨테이너ID>

# 이미지 삭제
docker rmi nginx

# 컨테이너 로그 보기
docker logs <컨테이너ID>

# 실행 중인 컨테이너 안으로 들어가기
docker exec -it <컨테이너ID> bash
```

---

## Docker Compose

**여러 컨테이너를 한번에 띄우는 도구**

마이크로서비스는 서비스가 수십 개인데, 하나씩 `docker run` 하면 너무 힘듦.
`docker-compose.yml` 파일 하나로 전체 서비스를 정의하고 한 번에 실행.

```yaml
# docker-compose.yml 예시
services:
  frontend:
    image: my-frontend
    ports:
      - "3000:3000"

  backend:
    image: my-backend
    ports:
      - "8080:8080"
    environment:
      - DB_HOST=database

  database:
    image: postgres:15
    environment:
      - POSTGRES_PASSWORD=secret
```

```bash
# 전체 서비스 시작
docker compose up

# 백그라운드로 시작
docker compose up -d

# 전체 서비스 종료
docker compose down

# 로그 확인
docker compose logs
```

---

## MicroTrace에서 Docker가 필요한 이유

구글 Microservices Demo는 **11개의 서비스**로 구성된 샘플 쇼핑몰.
각 서비스가 다른 언어(Go, Python, Java, Node.js...)로 만들어져 있음.

Docker 없이 이걸 로컬에서 실행하려면:
- Go 설치, Python 설치, Java 설치, Node.js 설치...
- 각 서비스 의존성 설치...
- 포트 충돌 해결...
- 환경변수 하나씩 설정...

Docker Compose로 실행하면:
```bash
docker compose up
# 끝. 브라우저로 localhost:8080 접속
```

---

## WSL2에 Docker 설치

### 방법 1: Docker Desktop (권장 - GUI 있음)
Windows에서 Docker Desktop 설치 → WSL2 통합 활성화
- [Docker Desktop 다운로드](https://www.docker.com/products/docker-desktop/)
- 설치 후 Settings → Resources → WSL Integration → Ubuntu 체크

### 방법 2: Docker Engine 직접 설치 (CLI만)
```bash
# 패키지 업데이트
sudo apt update

# 필요한 패키지 설치
sudo apt install -y ca-certificates curl gnupg

# Docker 공식 GPG 키 추가
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# 저장소 추가
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list

# Docker 설치
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# sudo 없이 docker 쓰기 위해 그룹 추가
sudo usermod -aG docker $USER
newgrp docker

# 확인
docker --version
docker compose version
```

---

## 네트워크 (MicroTrace 관련)

컨테이너끼리 통신할 때 Docker는 가상 네트워크를 만들어줌.

```
Docker 네트워크:
  frontend  →  backend  →  database
  (172.17.0.2) (172.17.0.3) (172.17.0.4)

컨테이너 이름으로 DNS처럼 접근 가능:
  http://backend:8080   ← IP 대신 서비스 이름 사용
```

**MicroTrace 관점에서 중요한 이유:**
eBPF는 호스트 커널에서 실행되므로, 컨테이너 안의 TCP 트래픽도 전부 관찰 가능.
`172.17.x.x` 같은 Docker 내부 IP가 찍히면 컨테이너 간 통신임.