// Regression tests for the networking hot path. These drive real loopback
// sockets: bind, connect, accept, send and receive. The point is to prove the
// stack moves real bytes and fails closed when no transport is available,
// rather than counting operations it never performed.

#include <arpa/inet.h>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#include <vector>

#define TIGEREX_HOT_PATH_NO_MAIN
#include "../src/networking/hot_path.cpp"

namespace {

int failures = 0;

void check(bool condition, const char* message) {
    if (condition) {
        std::cout << "ok: " << message << std::endl;
    } else {
        std::cout << "FAIL: " << message << std::endl;
        failures++;
    }
}

int connectClient(uint16_t port) {
    int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    ::inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
    if (::connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
        ::close(fd);
        return -1;
    }
    return fd;
}

void testLoopbackRoundTrip() {
    tigerex::NetworkStack stack;
    tigerex::SocketConfig cfg{};
    cfg.port = 0;
    cfg.nonBlocking = false; // blocking accept/recv keeps the test deterministic

    check(stack.configureSocket(cfg), "listening socket is created");
    check(stack.startAccept(0, 8), "socket binds and listens");
    uint16_t port = stack.localPort();
    check(port != 0, "kernel assigned a bound port");

    int client = connectClient(port);
    check(client >= 0, "client connects to the listening socket");

    tigerex::Connection accepted;
    check(stack.acceptConnection(accepted), "server accepts the connection");
    check(accepted.fd >= 0, "accepted connection carries a descriptor");
    check(accepted.remoteAddr == "127.0.0.1", "peer address is reported");

    const char payload[] = "tigerex";
    ssize_t written = ::send(client, payload, sizeof(payload) - 1, 0);
    check(written == static_cast<ssize_t>(sizeof(payload) - 1), "client writes the payload");

    tigerex::PacketBuffer in{};
    check(stack.recvPacket(accepted.fd, in), "server receives a packet");
    check(in.length == sizeof(payload) - 1 &&
              std::memcmp(in.data, payload, in.length) == 0,
          "received bytes match what was sent");

    tigerex::PacketBuffer out{};
    std::memcpy(out.data, "pong", 4);
    out.length = 4;
    check(stack.sendPacket(accepted.fd, out), "server sends a reply");

    char reply[8] = {0};
    ssize_t got = ::recv(client, reply, sizeof(reply), 0);
    check(got == 4 && std::memcmp(reply, "pong", 4) == 0, "client reads the reply");

    tigerex::NetworkStats stats{};
    stack.getStats(stats);
    check(stats.packetsReceived.load() == 1, "one packet counted as received");
    check(stats.packetsSent.load() == 1, "one packet counted as sent");
    check(stats.bytesReceived.load() == sizeof(payload) - 1, "received byte count is exact");
    check(stats.bytesSent.load() == 4, "sent byte count is exact");

    ::close(client);
    stack.stop();
}

void testZeroCopyFailsClosed() {
    tigerex::NetworkStack stack;
    check(!stack.sendZeroCopy("x", 1), "sendZeroCopy fails closed without a provider");
    uint32_t length = 99;
    check(!stack.recvZeroCopy(nullptr, length), "recvZeroCopy fails closed without a provider");
    check(length == 0, "recvZeroCopy clears the length on failure");

    tigerex::NetworkStats stats{};
    stack.getStats(stats);
    check(stats.packetsSent.load() == 0, "no phantom sends were counted");
    check(stats.errors.load() == 2, "both zero-copy attempts recorded an error");
}

void testSendRejectsOversizePacket() {
    tigerex::NetworkStack stack;
    tigerex::PacketBuffer tooBig{};
    tooBig.length = sizeof(tooBig.data) + 1;
    check(!stack.sendPacket(0, tooBig), "oversize packet is rejected before any syscall");
}

void testEventLoopReportsRealReadiness() {
    int fds[2];
    if (::pipe(fds) != 0) {
        check(false, "pipe() for the event-loop test");
        return;
    }
    tigerex::EventLoop loop;
    check(loop.valid(), "epoll instance is created");
    check(loop.addFd(fds[0], EPOLLIN), "pipe read end is registered");

    std::vector<epoll_event> ready;
    check(loop.poll(0, ready) == 0, "empty pipe is not reported ready");

    const char byte = 'x';
    ::write(fds[1], &byte, 1);
    int n = loop.poll(1000, ready);
    check(n == 1 && ready[0].data.fd == fds[0], "written pipe end is reported ready");

    check(loop.removeFd(fds[0]), "descriptor is removed from the loop");
    ::close(fds[0]);
    ::close(fds[1]);
}

} // namespace

int main() {
    testLoopbackRoundTrip();
    testZeroCopyFailsClosed();
    testSendRejectsOversizePacket();
    testEventLoopReportsRealReadiness();

    if (failures != 0) {
        std::cout << failures << " networking test(s) failed" << std::endl;
        return 1;
    }
    std::cout << "all networking hot-path tests passed" << std::endl;
    return 0;
}
