// CMakeLists.txt - C++ Matching Engine
cmake_minimum_required(VERSION 3.20)
project(tigerex_matcher VERSION 2.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Optimization flags
if(CMAKE_BUILD_TYPE STREQUAL "Release")
    set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -O3 -march=native -mtune=native")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DNDEBUG")
endif()

# Warnings
add_compile_options(-Wall -Wextra -Wpedantic)

# Dependencies
find_package(Threads REQUIRED)
find_package(Boost 1.80 COMPONENTS system thread filesystem REQUIRED)

# Source files
set(SOURCES
    src/matching_engine.cpp
    src/order_book.cpp
    src/tradeExecutor.cpp
)

# Headers
set(HEADERS
    include/matching_engine.h
    include/order_book.h
    include/tradeExecutor.h
)

# Create executable
add_executable(tigerex-matcher ${SOURCES} ${HEADERS})

target_include_directories(tigerex-matcher PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(tigerex-matcher PRIVATE Threads::Threads Boost::system Boost::thread Boost::filesystem)

# Benchmark
add_executable(benchmark src/benchmark.cpp ${HEADERS})
target_link_libraries(benchmark PRIVATE Threads::Threads Boost::system)