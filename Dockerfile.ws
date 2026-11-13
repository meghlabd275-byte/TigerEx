# TigerEx WebSocket server.
#
# The socket surface is served by the Go gateway (`cmd/tigerex-api`), whose
# `internal/ws` handler owns the upgrader, the origin allowlist and the handshake
# timeout. There is no separate WebSocket binary: the former `Dockerfile.ws`
# referenced by docker-compose never existed, and a second server would be a
# second upgrader, which the repository rules forbid. This image therefore builds
# the same gateway; run it as the `websocket` service only to give the socket a
# dedicated replica.
FROM golang:1.23-bookworm AS builder
WORKDIR /src
COPY backend/go/go.mod backend/go/go.sum ./
RUN go mod download
COPY backend/go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/tigerex-api ./cmd/tigerex-api

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=builder /out/tigerex-api /app/tigerex-api
ENV TIGEREX_PORT=8081
EXPOSE 8081
USER nonroot:nonroot
ENTRYPOINT ["/app/tigerex-api"]
