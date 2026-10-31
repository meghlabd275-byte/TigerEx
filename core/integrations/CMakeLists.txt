cmake_minimum_required(VERSION 3.20)
project(TigerExIntegrations VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_compile_options(-Wall -Wextra -Wpedantic)

find_package(Threads REQUIRED)
find_package(OpenSSL REQUIRED)
find_package(CURL REQUIRED)
find_package(nlohmann_json REQUIRED)

# Header-only integration layer: TigerSmartChain, Tigerswap and TigerWallet.
add_library(tigerex_integrations INTERFACE)
target_include_directories(tigerex_integrations INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(tigerex_integrations
    INTERFACE Threads::Threads OpenSSL::Crypto CURL::libcurl nlohmann_json::nlohmann_json)

enable_testing()

add_executable(tigerex-integration-tests tests/test_integrations.cpp)
target_link_libraries(tigerex-integration-tests PRIVATE tigerex_integrations)

add_test(NAME integrations COMMAND tigerex-integration-tests)
