FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod .
COPY service_a/main.go .
RUN go build -o service_a main.go

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/service_a .
CMD ["./service_a"]
