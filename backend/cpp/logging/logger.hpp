#pragma once

#include <iostream>
#include <fstream>
#include <string>
#include <mutex>
#include <chrono>

enum class LogLevel { DEBUG, INFO, WARN, ERROR };

class Logger {
private:
    static Logger* instance;
    std::ofstream file;
    std::mutex mtx;
    
    Logger() {}
    
public:
    static Logger* getInstance() {
        if (!instance) {
            instance = new Logger();
        }
        return instance;
    }
    
    void init(const std::string& filepath) {
        file.open(filepath, std::ios::app);
    }
    
    void log(LogLevel level, const std::string& msg) {
        std::lock_guard<std::mutex> lock(mtx);
        std::cout << "[" << level << "] " << msg << std::endl;
    }
    
    void debug(const std::string& msg) { log(LogLevel::DEBUG, msg); }
    void info(const std::string& msg) { log(LogLevel::INFO, msg); }
    void error(const std::string& momsg) { log(LogLevel::ERROR, momsg); }
};

Logger* Logger::instance = nullptr;