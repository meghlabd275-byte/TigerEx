// Networking Hot Path - kernel-bypass style packet processing.
//
// The socket and event-loop paths here are real: they call socket(2),
// setsockopt(2), bind(2), listen(2), accept4(2), recv(2)/send(2) and epoll(7).
// The zero-copy (RDMA) paths have no provider available in this build, so they
// fail closed instead of pretending to transmit; the counters only move when a
// syscall actually moved bytes.

#include <arpa/inet.h>
#include <cerrno>
#include <cstdint>
#include <cstring>
#include <ctime>
#include <fcntl.h>
#include <iostream>
#include <mutex>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sched.h>
#include <string>
#include <sys/epoll.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
#include <vector>
#include <atomic>

namespace tigerex {

// Packet buffer. This is a plain owned buffer, not a zero-copy descriptor; the
// RDMA path that would wrap a registered memory region is not built here.
struct PacketBuffer {
    char data[2048];
    uint32_t length{0};
    uint32_t capacity{sizeof(data)};
    uint64_t timestamp{0};
};

// Network statistics
struct NetworkStats {
    std::atomic<uint64_t> packetsReceived{0};
    std::atomic<uint64_t> packetsSent{0};
    std::atomic<uint64_t> bytesReceived{0};
    std::atomic<uint64_t> bytesSent{0};
    std::atomic<uint64_t> errors{0};
};

// Socket configuration
struct SocketConfig {
    std::string interface;
    uint16_t port{0};
    bool reuseAddr{true};
    bool reusePort{true};
    bool noDelay{true}; // TCP_NODELAY
    int backlog{1024};
    int recvBufSize{0};
    int sendBufSize{0};
    bool nonBlocking{true};
};

// Port configuration (DPDK-style; used to size buffers, not to bind hardware).
struct PortConfig {
    std::string name;
    uint16_t rxQueues{1};
    uint16_t txQueues{1};
    uint32_t rxDescCount{1024};
    uint32_t txDescCount{1024};
    uint32_t mtu{1500};
    bool checksumOffload{false};
    bool VLANOffload{false};
};

enum class ConnState {
    ACCEPTING,
    CONNECTED,
    CLOSING,
    CLOSED
};

// Connection
struct Connection {
    int fd{-1};
    uint32_t connId{0};
    std::string remoteAddr;
    uint16_t remotePort{0};
    ConnState state{ConnState::CLOSED};
    uint64_t connectedAt{0};
    uint64_t lastActivity{0};
    uint64_t bytesRecv{0};
    uint64_t bytesSent{0};
};

// Network stack backed by real POSIX sockets.
class NetworkStack {
private:
    std::vector<Connection> connections;
    std::mutex connMutex;
    NetworkStats stats;
    std::atomic<bool> running{false};
    int listenFd{-1};
    uint32_t nextConnId{1};

    static bool setNonBlocking(int fd) {
        int flags = ::fcntl(fd, F_GETFL, 0);
        if (flags < 0) return false;
        return ::fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0;
    }

public:
    NetworkStack() = default;

    NetworkStack(const NetworkStack&) = delete;
    NetworkStack& operator=(const NetworkStack&) = delete;

    ~NetworkStack() { stop(); }

    // Create and configure a listening socket. Returns false and reports the
    // failing errno when any syscall fails.
    bool configureSocket(const SocketConfig& config) {
        int fd = ::socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
        if (fd < 0) {
            std::cerr << "socket() failed: " << std::strerror(errno) << std::endl;
            stats.errors++;
            return false;
        }
        int one = 1;
        if (config.reuseAddr &&
            ::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one)) != 0) {
            std::cerr << "SO_REUSEADDR failed: " << std::strerror(errno) << std::endl;
            ::close(fd);
            stats.errors++;
            return false;
        }
        if (config.reusePort &&
            ::setsockopt(fd, SOL_SOCKET, SO_REUSEPORT, &one, sizeof(one)) != 0) {
            std::cerr << "SO_REUSEPORT failed: " << std::strerror(errno) << std::endl;
            ::close(fd);
            stats.errors++;
            return false;
        }
        if (config.noDelay &&
            ::setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one)) != 0) {
            std::cerr << "TCP_NODELAY failed: " << std::strerror(errno) << std::endl;
            ::close(fd);
            stats.errors++;
            return false;
        }
        if (config.recvBufSize > 0) {
            int sz = config.recvBufSize;
            ::setsockopt(fd, SOL_SOCKET, SO_RCVBUF, &sz, sizeof(sz));
        }
        if (config.sendBufSize > 0) {
            int sz = config.sendBufSize;
            ::setsockopt(fd, SOL_SOCKET, SO_SNDBUF, &sz, sizeof(sz));
        }
        if (config.nonBlocking && !setNonBlocking(fd)) {
            std::cerr << "fcntl(O_NONBLOCK) failed: " << std::strerror(errno) << std::endl;
            ::close(fd);
            stats.errors++;
            return false;
        }
        if (listenFd >= 0) ::close(listenFd);
        listenFd = fd;
        return true;
    }

    // Bind the configured socket to the given port and start listening.
    bool startAccept(uint16_t port, uint32_t backlog) {
        if (listenFd < 0) {
            std::cerr << "startAccept called before configureSocket" << std::endl;
            stats.errors++;
            return false;
        }
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = htonl(INADDR_ANY);
        addr.sin_port = htons(port);
        if (::bind(listenFd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
            std::cerr << "bind() failed: " << std::strerror(errno) << std::endl;
            stats.errors++;
            return false;
        }
        if (::listen(listenFd, static_cast<int>(backlog)) != 0) {
            std::cerr << "listen() failed: " << std::strerror(errno) << std::endl;
            stats.errors++;
            return false;
        }
        running = true;
        return true;
    }

    // The listening descriptor, or -1 when not listening.
    int listenDescriptor() const { return listenFd; }

    // The bound port, or 0 when not listening. Useful when port 0 was requested.
    uint16_t localPort() const {
        if (listenFd < 0) return 0;
        sockaddr_in addr{};
        socklen_t len = sizeof(addr);
        if (::getsockname(listenFd, reinterpret_cast<sockaddr*>(&addr), &len) != 0) return 0;
        return ntohs(addr.sin_port);
    }

    // Accept one pending connection. Returns false when no connection is ready
    // (EAGAIN) or the accept failed.
    bool acceptConnection(Connection& out) {
        if (listenFd < 0) return false;
        sockaddr_in peer{};
        socklen_t len = sizeof(peer);
        int fd = ::accept4(listenFd, reinterpret_cast<sockaddr*>(&peer), &len, SOCK_CLOEXEC);
        if (fd < 0) {
            if (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
                stats.errors++;
            }
            return false;
        }
        char ip[INET_ADDRSTRLEN] = {0};
        ::inet_ntop(AF_INET, &peer.sin_addr, ip, sizeof(ip));

        Connection conn;
        conn.fd = fd;
        conn.connId = nextConnId++;
        conn.remoteAddr = ip;
        conn.remotePort = ntohs(peer.sin_port);
        conn.state = ConnState::CONNECTED;
        conn.connectedAt = static_cast<uint64_t>(::time(nullptr));

        {
            std::lock_guard<std::mutex> lock(connMutex);
            connections.push_back(conn);
        }
        out = conn;
        return true;
    }

    // Receive into a packet buffer over a connected socket.
    bool recvPacket(int fd, PacketBuffer& packet) {
        if (fd < 0) {
            stats.errors++;
            return false;
        }
        ssize_t n = ::recv(fd, packet.data, sizeof(packet.data), 0);
        if (n <= 0) {
            if (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
                stats.errors++;
            }
            return false;
        }
        packet.length = static_cast<uint32_t>(n);
        packet.timestamp = static_cast<uint64_t>(::time(nullptr));
        stats.packetsReceived++;
        stats.bytesReceived += static_cast<uint64_t>(n);
        return true;
    }

    // Send a packet buffer over a connected socket.
    bool sendPacket(int fd, const PacketBuffer& packet) {
        if (fd < 0 || packet.length > sizeof(packet.data)) {
            stats.errors++;
            return false;
        }
        ssize_t n = ::send(fd, packet.data, packet.length, MSG_NOSIGNAL);
        if (n < 0 || static_cast<uint32_t>(n) != packet.length) {
            stats.errors++;
            return false;
        }
        stats.packetsSent++;
        stats.bytesSent += static_cast<uint64_t>(n);
        return true;
    }

    // Batch send. Returns the number of packets fully written.
    size_t sendBatch(int fd, const std::vector<PacketBuffer>& packets) {
        size_t sent = 0;
        for (const auto& pkt : packets) {
            if (sendPacket(fd, pkt)) sent++;
        }
        return sent;
    }

    void getStats(NetworkStats& outStats) {
        outStats.packetsReceived.store(stats.packetsReceived.load());
        outStats.packetsSent.store(stats.packetsSent.load());
        outStats.bytesReceived.store(stats.bytesReceived.load());
        outStats.bytesSent.store(stats.bytesSent.load());
        outStats.errors.store(stats.errors.load());
    }

    // Zero-copy transmit requires an RDMA/registered-memory provider that is
    // not present in this build. It fails closed rather than counting a send
    // that never happened.
    bool sendZeroCopy(const char* /*data*/, uint32_t /*length*/) {
        stats.errors++;
        return false;
    }

    // Zero-copy receive, same reasoning as sendZeroCopy.
    bool recvZeroCopy(char* /*buffer*/, uint32_t& length) {
        length = 0;
        stats.errors++;
        return false;
    }

    void stop() {
        if (listenFd >= 0) {
            ::close(listenFd);
            listenFd = -1;
        }
        std::lock_guard<std::mutex> lock(connMutex);
        for (auto& conn : connections) {
            if (conn.fd >= 0) {
                ::close(conn.fd);
                conn.fd = -1;
            }
            conn.state = ConnState::CLOSED;
        }
        connections.clear();
        running = false;
    }
};

// Real epoll-based event loop.
class EventLoop {
private:
    int epfd{-1};
    std::mutex fdMutex;

public:
    EventLoop() { epfd = ::epoll_create1(EPOLL_CLOEXEC); }
    ~EventLoop() {
        if (epfd >= 0) ::close(epfd);
    }

    EventLoop(const EventLoop&) = delete;
    EventLoop& operator=(const EventLoop&) = delete;

    bool valid() const { return epfd >= 0; }

    // Register a file descriptor for the given epoll events (e.g. EPOLLIN).
    bool addFd(int fd, uint32_t events) {
        if (epfd < 0 || fd < 0) return false;
        epoll_event ev{};
        ev.events = events;
        ev.data.fd = fd;
        std::lock_guard<std::mutex> lock(fdMutex);
        return ::epoll_ctl(epfd, EPOLL_CTL_ADD, fd, &ev) == 0;
    }

    bool removeFd(int fd) {
        if (epfd < 0 || fd < 0) return false;
        std::lock_guard<std::mutex> lock(fdMutex);
        return ::epoll_ctl(epfd, EPOLL_CTL_DEL, fd, nullptr) == 0;
    }

    // Wait for ready descriptors. Returns the number ready, 0 on timeout, or -1
    // on error (including a missing epoll instance).
    int poll(int timeoutMs, std::vector<epoll_event>& ready, int maxEvents = 1024) {
        if (epfd < 0) return -1;
        ready.resize(static_cast<size_t>(maxEvents));
        int n = ::epoll_wait(epfd, ready.data(), maxEvents, timeoutMs);
        if (n < 0) {
            if (errno == EINTR) return 0;
            return -1;
        }
        ready.resize(static_cast<size_t>(n));
        return n;
    }
};

// Try to back the given size with huge pages, falling back to ordinary
// anonymous memory. Returns true when the mapping (huge or not) succeeded;
// `usedHugePages` reports which one was obtained.
bool configureHugePages(size_t sizeBytes, bool& usedHugePages) {
    usedHugePages = false;
    void* p = ::mmap(nullptr, sizeBytes, PROT_READ | PROT_WRITE,
                     MAP_PRIVATE | MAP_ANONYMOUS | MAP_HUGETLB, -1, 0);
    if (p != MAP_FAILED) {
        ::munmap(p, sizeBytes);
        usedHugePages = true;
        return true;
    }
    p = ::mmap(nullptr, sizeBytes, PROT_READ | PROT_WRITE,
               MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (p == MAP_FAILED) {
        return false;
    }
    ::munmap(p, sizeBytes);
    return true;
}

// Pin the calling thread to the first CPU of the given NUMA node. This is a
// real sched_setaffinity call; it returns false when the kernel rejects it.
bool configureNUMA(int node) {
    if (node < 0 || node >= CPU_SETSIZE) return false;
    cpu_set_t set;
    CPU_ZERO(&set);
    CPU_SET(node, &set);
    return ::sched_setaffinity(0, sizeof(set), &set) == 0;
}

} // namespace tigerex

#ifndef TIGEREX_HOT_PATH_NO_MAIN
int main() {
    using namespace tigerex;

    NetworkStack stack;

    SocketConfig sockConfig{};
    sockConfig.interface = "0.0.0.0";
    sockConfig.port = 0;
    sockConfig.reuseAddr = true;
    sockConfig.reusePort = true;
    sockConfig.noDelay = true;
    if (!stack.configureSocket(sockConfig)) {
        std::cerr << "failed to configure socket" << std::endl;
        return 1;
    }

    // Port 0 lets the kernel choose a free port, so the smoke run does not need
    // a privileged port and cannot collide with a real listener.
    if (!stack.startAccept(0, 1024)) {
        std::cerr << "failed to start accepting" << std::endl;
        return 1;
    }

    EventLoop loop;
    if (!loop.valid()) {
        std::cerr << "failed to create epoll instance: " << std::strerror(errno) << std::endl;
        return 1;
    }
    if (!loop.addFd(stack.listenDescriptor(), EPOLLIN)) {
        std::cerr << "failed to register the listen socket with epoll" << std::endl;
        return 1;
    }

    bool huge = false;
    if (!configureHugePages(64ULL * 1024 * 1024, huge)) {
        std::cerr << "failed to map the hot-path arena" << std::endl;
        return 1;
    }
    const bool numaPinned = configureNUMA(0);

    // Zero-copy must fail closed while no RDMA provider is configured.
    if (stack.sendZeroCopy(nullptr, 0)) {
        std::cerr << "sendZeroCopy reported success without a provider" << std::endl;
        return 1;
    }

    NetworkStats stats{};
    stack.getStats(stats);
    std::cout << "hot path ready on port " << stack.localPort()
              << ": huge_pages=" << (huge ? "yes" : "no")
              << " numa_pinned=" << (numaPinned ? "yes" : "no")
              << " errors=" << stats.errors.load() << std::endl;

    stack.stop();
    return 0;
}
#endif // TIGEREX_HOT_PATH_NO_MAIN
