/**
 * TigerEx Service Discovery
 * Built with C++ for ultra-low latency
 */

#include <iostream>
#include <map>
#include <string>
#include <atomic>
#include <mutex>

struct Service {
    std::string name;
    std::string address;
    int port;
    bool healthy;
};

class ServiceDiscovery {
private:
    std::map<std::string, std::vector<Service>> services_;
    std::atomic<uint64_t> lookups_{0};
    std::mutex mutex_;
    
public:
    void registerService(std::string name, std::string addr, int port) {
        std::lock_guard<std::mutex> lock(mutex_);
        services_[name].push_back({name, addr, port, true});
    }
    
    Service* findService(std::string name) {
        lookups_++;
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = services_.find(name);
        if (it == services_.end()) return nullptr;
        for (auto& svc : it->second) {
            if (svc.healthy) return &svc;
        }
        return nullptr;
    }
};

int main() {
    ServiceDiscovery sd;
    sd.registerService("api", "10.0.1.1", 8080);
    auto* svc = sd.findService("api");
    if (svc) std::cout << "Found: " << svc->address << "\n";
    return 0;
}
