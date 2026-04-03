FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod .
COPY service_b/main.go .
RUN go build -o service_b main.go

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/service_b .
EXPOSE 8080
CMD ["./service_b"]
