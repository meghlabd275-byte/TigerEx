cmake_minimum_required(VERSION 3.20)
project(TigerExMatchingEngine VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Release mode optimizations for production
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -march=native -mtune=native -flto")
set(CMAKE_CXX_FLAGS_DEBUG "-g -O0 -fsanitize=address,undefined")

# Find required packages
find_package(Threads REQUIRED)
find_package(OpenSSL REQUIRED)

# Include directories
include_directories(include)

# Source files
set(SOURCES
    src/order.cpp
    src/order_book.cpp
    src/matching_engine.cpp
    src/market.cpp
    src/risk_checker.cpp
)

# Headers
set(HEADERS
    include/order.hpp
    include/order_book.hpp
    include/matching_engine.hpp
)

# Create shared library
add_library(tigerex_matching SHARED ${SOURCES})

# Link libraries
target_link_libraries(tigerex_matching
    Threads::Threads
    OpenSSL::SSL
    OpenSSL::Crypto
)

# Set output directory
set_target_properties(tigerex_matching PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY ${CMAKE_SOURCE_DIR}/lib
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_SOURCE_DIR}/bin
)

# Installation
install(TARGETS tigerex_matching
    LIBRARY DESTINATION lib
    ARCHIVE DESTINATION lib
)