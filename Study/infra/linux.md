# Linux 기초

## 파일시스템 구조

Windows와 달리 Linux는 드라이브 문자(C:, D:)가 없고 `/` 하나에서 시작합니다.

```
/                      ← 루트. 모든 것의 시작점
├── home/
│   └── hadan2/        ← 내 홈 디렉토리. ~로 줄여 쓸 수 있음
├── usr/
│   └── local/
│       └── bin/       ← 사용자가 직접 설치한 프로그램들
├── etc/               ← 설정 파일들
└── tmp/               ← 임시 파일들
```

`~`는 `/home/hadan2`의 단축표현. `~/MicroTrace`는 `/home/hadan2/MicroTrace`와 같음.

---

## 기본 명령어

### 탐색
```bash
pwd          # 현재 내가 어디 있는지 출력 (print working directory)
ls           # 현재 폴더의 파일/폴더 목록
ls -la       # 숨김파일 포함, 권한/크기 등 상세 정보까지 출력
cd 폴더명    # 해당 폴더로 이동 (change directory)
cd ..        # 상위 폴더로 이동 (..)은 부모 폴더를 의미
cd ~         # 홈 디렉토리로 이동
```

### 파일/폴더 생성 및 삭제
```bash
mkdir 폴더명          # 폴더 생성 (make directory)
mkdir -p a/b/c        # 중간 폴더가 없어도 한번에 생성. 이미 있어도 에러 안 남
rm 파일명             # 파일 삭제
rm -rf 폴더명         # 폴더 통째로 삭제. -r(폴더 안까지), -f(확인 없이 강제)
                      # ⚠️ 위험한 명령어! 복구 불가능
cp 원본 대상          # 파일 복사
mv 원본 대상          # 파일 이동 또는 이름 변경
```

### 파일 내용 보기
```bash
cat 파일명    # 파일 전체 내용 출력
which 명령어  # 해당 명령어가 어디 설치돼 있는지 경로 출력
```

---

## sudo란?

```
일반 사용자(hadan2)
    │
    │  sudo 명령어
    ▼
관리자(root) 권한으로 실행
```

Linux는 보안상 일반 사용자가 시스템 파일을 수정하지 못하게 막아놓음.
`sudo`(superuser do)를 앞에 붙이면 관리자 권한으로 실행 가능.
설치, 시스템 설정 변경 등에 필요.

---

## apt - 패키지 관리자

Windows의 "Microsoft Store" 같은 것. 프로그램 설치/삭제 담당.

```bash
sudo apt update          # 설치 가능한 패키지 목록을 최신으로 갱신 (실제 설치 X)
                         # 마치 앱스토어 새로고침
sudo apt upgrade -y      # 현재 설치된 패키지들을 최신 버전으로 업그레이드
                         # -y : 중간에 "계속할까요?" 질문을 자동으로 yes 처리
sudo apt install -y 패키지명   # 패키지 설치
sudo apt remove 패키지명       # 패키지 삭제
```

---

## PATH란?

명령어를 입력했을 때 Linux가 실행파일을 찾는 디렉토리 목록.

```
$ go version  ← 이 명령어를 치면

Linux가 PATH에 등록된 폴더들을 순서대로 뒤짐:
/usr/bin/ → /usr/local/bin/ → /usr/local/go/bin/ → ...

/usr/local/go/bin/go 발견! → 실행
```

Go 설치 후 `echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc` 를 한 이유:
Go 실행파일이 있는 `/usr/local/go/bin`을 PATH에 추가해야 `go` 명령어를 어디서든 쓸 수 있기 때문.

### ~/.bashrc란?
터미널을 열 때마다 자동으로 실행되는 설정 파일.
여기에 PATH 추가를 써두면 터미널을 새로 열어도 Go가 항상 인식됨.

```bash
source ~/.bashrc   # 파일을 다시 읽어서 현재 세션에 즉시 적용
                   # 터미널 재시작 없이 변경사항 반영
```

---

## 설치 관련 명령어

```bash
wget URL            # URL에서 파일 다운로드 (web get)
tar -C /경로 -xzf 파일.tar.gz
# tar: 압축 해제 도구
# -C /경로 : 해당 경로에 압축 해제
# -x : 압축 해제 (extract)
# -z : gzip 형식
# -f : 파일 지정
```

---

## WSL2 특이사항

- WSL2는 Windows 위에서 실제 Linux 커널을 실행하는 가상화 기술
- Microsoft가 커스텀 커널을 사용하므로 일부 패키지(linux-headers 등)가 apt에 없음
- eBPF 개발에 필요한 커널 기능은 대부분 지원됨
- bpftool은 apt 설치 불가 → 소스에서 직접 빌드 필요 (WSL2 커널 버전 불일치 문제)
