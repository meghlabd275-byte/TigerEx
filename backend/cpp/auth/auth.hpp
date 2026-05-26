#pragma once

#include <string>
#include <map>
#include <mutex>
#include <vector>

namespace auth {

struct User {
    std::string id;
    std::string email;
    std::string hash;
    bool enabled;
};

class Authenticator {
private:
    std::map<std::string, User> users;
    std::map<std::string, std::vector<std::string>> sessions;
    std::mutex mtx;
    
public:
    bool registerUser(const std::string& id, const std::string& email, const std::string& pw) {
        std::lock_guard<std::mutex> lock(mtx);
        if (users.find(id) != users.end()) {
            return false;
        }
        users[id] = {id, email, hashpw(pw), true};
        return true;
    }
    
    bool authenticate(const std::string& id, const std::string& pw) {
        std::lock_guard<std::mutex> lock(mtx);
        auto it = users.find(id);
        return it != users.end() && it->second.hash == hashpw(pw);
    }
    
    std::string createSession(const std::string& userId) {
        std::lock_guard<std::mutex> lock(mtx);
        std::string token = generateToken();
        sessions[userId].push_back(token);
        return token;
    }
    
    bool validateSession(const std::string& userId, const std::string& token) {
        std::lock_guard<std::mutex> lock(mtx);
        auto it = sessions.find(userId);
        if (it == sessions.end()) return false;
        
        for (const auto& t : it->second) {
            if (t == token) return true;
        }
        return false;
    }
    
private:
    std::string hashpw(const std::string& pw);
    std::string generateToken();
};

} // namespace auth