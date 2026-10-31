cmake_minimum_required(VERSION 3.16)
project(tigerex_stock_trading CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(tigerex_stock_trading INTERFACE)
target_include_directories(tigerex_stock_trading INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include)

if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    enable_testing()
    add_executable(stock_trading_test tests/stock_trading_test.cpp)
    target_link_libraries(stock_trading_test PRIVATE tigerex_stock_trading)
    add_test(NAME stock_trading_test COMMAND stock_trading_test)
endif()
