#pragma once

#include <deque>
#include <mutex>
#include <functional>
#include <condition_variable>

namespace stream {

template<typename T>
class Processor {
private:
    std::deque<T> buffer;
    size_t max_size;
    std::mutex mtx;
    std::condition_variable cv;
    std::function<void(const T&)> handler;
    
public:
    Processor(size_t cap = 1000) : max_size(cap) {}
    
    void setHandler(std::function<void(const T&)> fn) {
        handler = fn;
    }
    
    bool push(const T& item) {
        std::unique_lock<std::mutex> lock(mtx);
        
        if (buffer.size() >= max_size) {
            return false;
        }
        
        buffer.push_back(item);
        
        if (handler) {
            handler(item);
        }
        
        cv.notify_one();
        return true;
    }
    
    bool pop(T& item) {
        std::unique_lock<std::mutex> lock(mtx);
        cv.wait(lock, [this] { return !buffer.empty(); });
        
        item = buffer.front();
        buffer.pop_front();
        return true;
    }
    
    size_t size() {
        std::lock_guard<std::mutex> lock(mtx);
        return buffer.size();
    }
};

} // namespace stream