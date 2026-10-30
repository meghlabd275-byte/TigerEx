/**
 * TigerEx WebSocket Server - C++
 * High-performance WebSocket for real-time
 */

#include <iostream>
#include <fstream>
#include <map>
#include <set>
#include <vector>
#include <string>
#include <cstdint>
#include <functional>

// ============================================================================
// WEBSOCKET MESSAGE
// ============================================================================

struct WSMessage {
    std::string opcode;
    std::string data;
    std::string client_id;
};

struct WSClient {
    std::string id;
    std::string endpoint;
    bool authenticated;
    std::vector<std::string> subscriptions;
};

// ============================================================================
// HUB
// ============================================================================

class WSHub {
public:
    // Verifies an authentication token. The real exchange wires this to the
    // token store; there is deliberately no default implementation that
    // accepts any token.
    using TokenVerifier = std::function<bool(const std::string& token)>;

private:
    std::map<std::string, WSClient> clients;
    std::map<std::string, std::vector<std::string>> subscriptions;
    uint64_t next_id;
    TokenVerifier verify_token_;

public:
    explicit WSHub(TokenVerifier verifier) : next_id(1000), verify_token_(std::move(verifier)) {}

    std::string connect(const std::string& endpoint) {
        std::string id = "ws_" + std::to_string(next_id++);
        clients[id] = {id, endpoint, false, {}};
        return id;
    }

    // Fails closed: without a verifier every token is rejected, and a token is
    // only accepted when the configured verifier accepts it.
    bool authenticate(const std::string& client_id, const std::string& token) {
        auto it = clients.find(client_id);
        if (it == clients.end()) return false;
        if (!verify_token_) return false;
        if (!verify_token_(token)) return false;
        it->second.authenticated = true;
        return true;
    }

    // Subscribing to a private channel requires an authenticated client.
    bool subscribe(const std::string& client_id, const std::string& channel) {
        auto it = clients.find(client_id);
        if (it == clients.end()) return false;
        if (!it->second.authenticated) return false;

        auto& cl = it->second;
        cl.subscriptions.push_back(channel);
        subscriptions[channel].push_back(client_id);
        return true;
    }

    bool publish(const std::string& channel, const std::string& data) {
        auto it = subscriptions.find(channel);
        if (it == subscriptions.end()) return false;

        std::cout << "Publishing to " << it->second.size() << " clients" << std::endl;
        return true;
    }

    bool send(const std::string& client_id, const std::string& message) {
        if (clients.find(client_id) == clients.end()) return false;
        std::cout << "Sending to " << client_id << ": " << message << std::endl;
        return true;
    }

    size_t client_count() { return clients.size(); }
};

// ============================================================================
// ROUTER
// ============================================================================

class WSRouter {
private:
    std::map<std::string, std::function<void(WSMessage&)>> handlers;

public:
    void register_handler(const std::string& event, std::function<void(WSMessage&)> handler) {
        handlers[event] = handler;
    }

    void route(const WSMessage& msg) {
        auto it = handlers.find(msg.opcode);
        if (it != handlers.end()) {
            WSMessage m = msg;
            it->second(m);
        }
    }
};

// ============================================================================
// MAIN
// ============================================================================

int main(int argc, char** argv) {
    // Tokens are loaded from a file given on the command line (one token per
    // line). Without a readable file no token is accepted; nothing is
    // hardcoded.
    if (argc < 2) {
        std::cerr << "usage: websocket-gateway <tokens.txt> [token]" << std::endl;
        return 1;
    }

    std::set<std::string> tokens;
    std::ifstream file(argv[1]);
    if (!file.is_open()) {
        std::cerr << "Cannot open token file: " << argv[1] << std::endl;
        return 1;
    }
    std::string line;
    while (std::getline(file, line)) {
        if (!line.empty()) tokens.insert(line);
    }

    WSHub hub([&tokens](const std::string& token) {
        return tokens.find(token) != tokens.end();
    });

    std::string client = hub.connect("/ws");
    std::cout << "Connected: " << client << std::endl;

    // Subscribing before authentication is rejected.
    if (!hub.subscribe(client, "BTC/USDT@trade")) {
        std::cout << "Subscribe rejected before authentication" << std::endl;
    }

    if (argc >= 3 && hub.authenticate(client, argv[2])) {
        hub.subscribe(client, "BTC/USDT@trade");
        hub.subscribe(client, "BTC/USDT@depth");
        hub.publish("BTC/USDT@trade", "{\"price\":50000,\"size\":0.1}");
    } else {
        std::cout << "Client not authenticated" << std::endl;
    }

    std::cout << "Active clients: " << hub.client_count() << std::endl;

    return 0;
}
