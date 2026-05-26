/**
 * TigerEx WebSocket Server - C++
 * High-performance WebSocket for real-time
 */

#include <iostream>
#include <map>
#include <vector>
#include <string>
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
private:
    std::map<std::string, WSClient> clients;
    std::map<std::string, std::vector<std::string>> subscriptions;
    uint64_t next_id;

public:
    WSHub() : next_id(1000) {}

    std::string connect(const std::string& endpoint) {
        std::string id = "ws_" + std::to_string(next_id++);
        clients[id] = {id, endpoint, false, {}};
        return id;
    }

    bool authenticate(const std::string& client_id, const std::string& token) {
        if (clients.find(client_id) == clients.end()) return false;
        clients[client_id].authenticated = true;
        return true;
    }

    bool subscribe(const std::string& client_id, const std::string& channel) {
        auto& cl = clients[client_id];
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

int main() {
    WSHub hub;
    
    std::string client = hub.connect("/ws");
    std::cout << "Connected: " << client << std::endl;
    
    hub.authenticate(client, "token123");
    hub.subscribe(client, "BTC/USDT@trade");
    hub.subscribe(client, "BTC/USDT@depth");
    
    hub.publish("BTC/USDT@trade", "{\"price\":50000,\"size\":0.1}");
    
    std::cout << "Active clients: " << hub.client_count() << std::endl;
    
    return 0;
}