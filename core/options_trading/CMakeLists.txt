cmake_minimum_required(VERSION 3.16)
project(tigerex_options_trading CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(tigerex_options_trading INTERFACE)
target_include_directories(tigerex_options_trading INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include)

if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    enable_testing()
    add_executable(options_engine_test tests/options_engine_test.cpp)
    target_link_libraries(options_engine_test PRIVATE tigerex_options_trading)
    add_test(NAME options_engine_test COMMAND options_engine_test)
endif()
