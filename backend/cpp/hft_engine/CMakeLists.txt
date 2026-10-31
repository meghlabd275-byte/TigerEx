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

# Header-only engine: the implementation lives in include/hft_engine.hpp, so
# there is no library to compile. The test target proves it compiles and works.
find_package(Threads REQUIRED)
add_executable(hft_engine_test tests/hft_engine_test.cpp)
target_include_directories(hft_engine_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(hft_engine_test PRIVATE Threads::Threads)

enable_testing()
add_test(NAME hft_engine_test COMMAND hft_engine_test)

# Install
install(DIRECTORY include/ DESTINATION include/tigerex_hft)
