cmake_minimum_required(VERSION 3.16)
project(tigerex_ai_trading_bot CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(tigerex_ai_trading_bot INTERFACE)
target_include_directories(tigerex_ai_trading_bot INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include)

if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    enable_testing()
    add_executable(ai_trading_bot_test tests/ai_trading_bot_test.cpp)
    target_link_libraries(ai_trading_bot_test PRIVATE tigerex_ai_trading_bot)
    add_test(NAME ai_trading_bot_test COMMAND ai_trading_bot_test)
endif()
