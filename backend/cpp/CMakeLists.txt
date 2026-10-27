cmake_minimum_required(VERSION 3.20)
project(tigerex_matcher VERSION 2.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(CMAKE_BUILD_TYPE STREQUAL "Release")
    set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -O3 -march=native -mtune=native")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DNDEBUG")
endif()

add_compile_options(-Wall -Wextra -Wpedantic)

find_package(Threads REQUIRED)

# Core order book / matching engine, shared by the programs below.
add_library(tigerex_core STATIC src/matching_engine.cpp)
target_include_directories(tigerex_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(tigerex_core PUBLIC Threads::Threads)

# Each entry point is a self-contained program and several define their own
# OrderBook, so they are built as separate targets rather than one binary.
set(TIGEREX_PROGRAMS
    order-book:src/order_book.cpp
    order-router:src/order_router.cpp
    reporting:src/reporting.cpp
    hft-engine:src/hft_engine.cpp
    hot-path:src/networking/hot_path.cpp
    matching-engine-v2:src/matching/matching_engine.cpp
    matching-engine-simple:matching_engine/engine.cpp
    market-maker:hft/market_maker.cpp
    websocket-gateway:websocket/websocket.cpp
)

foreach(entry IN LISTS TIGEREX_PROGRAMS)
    string(REPLACE ":" ";" parts "${entry}")
    list(GET parts 0 name)
    list(GET parts 1 source)
    add_executable(${name} ${source})
    target_link_libraries(${name} PRIVATE Threads::Threads)
    if(NOT name STREQUAL "order-book")
        target_link_libraries(${name} PRIVATE tigerex_core)
    endif()
endforeach()

enable_testing()
add_executable(matching-engine-tests tests/matching_engine_test.cpp)
target_link_libraries(matching-engine-tests PRIVATE tigerex_core Threads::Threads)
add_test(NAME matching-engine-tests COMMAND matching-engine-tests)
