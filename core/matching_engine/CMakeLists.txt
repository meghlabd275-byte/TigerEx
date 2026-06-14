cmake_minimum_required(VERSION 3.20)
project(TigerExMatchingEngine VERSION 1.0.0 LANGUAGES CXX)

# C++ standard
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Build type
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

# Compiler flags
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -march=native -mtune=native")
set(CMAKE_CXX_FLAGS_DEBUG "-g -O0 -Wall -Wextra")

# Enable link-time optimization
set(CMAKE_INTERPROCEDURAL_OPTIMIZATION_RELEASE ON)

# Source files
set(SOURCES
    src/matching_engine.cpp
)

# Headers
set(HEADERS
    include/order_book.hpp
)

# Create executable
add_executable(matching_engine ${SOURCES} ${HEADERS})

# Include directories
target_include_directories(matching_engine PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# Platform-specific libraries
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    target_link_libraries(matching_engine
        pthread
        rt
        m
        dl
    )
elseif(CMAKE_SYSTEM_NAME STREQUAL "Darwin")
    target_link_libraries(matching_engine
        pthread
        dl
    )
elseif(CMAKE_SYSTEM_NAME STREQUAL "Windows")
    target_link_libraries(matching_engine
        ws2_32
        advapi32
    )
endif()

# Enable testing
enable_testing()

# Add test executable
add_executable(matching_engine_test
    tests/test_matching_engine.cpp
    src/matching_engine.cpp
)

target_include_directories(matching_engine_test PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(matching_engine_test
    pthread
    rt
    m
    dl
)

# Benchmark executable
add_executable(matching_engine_benchmark
    tests/benchmark.cpp
    src/matching_engine.cpp
)

target_include_directories(matching_engine_benchmark PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(matching_engine_benchmark
    pthread
    rt
    m
    dl
)

# Install
install(TARGETS matching_engine
    RUNTIME DESTINATION bin
)

install(FILES ${HEADERS}
    DESTINATION include/tigerex
)