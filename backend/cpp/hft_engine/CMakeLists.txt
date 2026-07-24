cmake_minimum_required(VERSION 3.20)
project(TigerExHFTEngine VERSION 3.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Release optimizations for ultra-low latency
set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -O3 -march=native -mtune=native")
set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -ffast-math -funroll-loops")
set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -fomit-frame-pointer -fno-stack-protector")

# Include directories
include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

# Source files
set(HFT_SOURCES
    src/hft_engine.cpp
    src/order_manager.cpp
    src/risk_engine.cpp
    src/execution.cpp
    src/network.cpp
    src/metrics.cpp
)

# Create library
add_library(tigerex_hft STATIC ${HFT_SOURCES})

# Link libraries
target_link_libraries(tigerex_hft
    pthread
    rt
    dl
)

# Install
install(TARGETS tigerex_hft DESTINATION lib)
install(DIRECTORY include/ DESTINATION include/tigerex_hft)
