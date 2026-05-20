# Ultra Low Latency Domain

> **Critical Path**: This domain handles the most latency-sensitive operations in the exchange.

## Performance Targets

| Component | Target Latency | Throughput |
|-----------|---------------|------------|
| Matching Engine | < 500ns | 5M+ orders/sec |
| Market Data | < 1μs | 10M+ ticks/sec |
| Risk Checks | < 5μs | 1M+ checks/sec |
| Network (DPDK) | < 10μs | 100Gbp/s |

## Submodules

### matching_engine/ - C++
Core order matching functionality - the heart of the exchange.

**Key Components:**
- `order_matching_core/` - Price-time priority matching
- `lockfree_orderbook/` - Lock-free order book implementation
- `memory_pool_allocator/` - Custom allocators for zero-allocation hot paths
- `kernel_bypass_networking/` - DPDK/RDMA packet processing
- `nanosecond_timestamping/` - Hardware timestamping

**Language: C++17/20**

Why C++ for matching:
- Zero garbage collection pauses
- Sub-microsecond memory allocation control
- SIMD optimization capability
- Cache-aware data structures
- Lock-free concurrency primitives
- Direct hardware access

### ultra_low_latency_risk/ - Rust
Pre-trade risk checks executing alongside matching.

**Key Components:**
- `pre_trade_risk_checks/` - Real-time risk validation
- `margin_engine/` - Margin calculation
- `liquidation_engine/` - Automated liquidation
- `adl_engine/` - Auto-deleveraging

**Language: Rust**

Why Rust for risk:
- Memory safety without GC
- Deterministic performance
- Fearless concurrency
- Cryptography ecosystem

### hardware_acceleration/
FPGA and SmartNIC offloading.

**Components:**
- `fpga_gateware/` - Verilog/VHDL gateware
- `smartnic_programming/` - C for SmartNICs
- `packet_parsing/` - Wire-speed parsing
- `tick_to_trade/` - Feed handler acceleration

### experimental_latency_systems/
Research and experimental work in Zig.

## Network Architecture

```
[Colo Network] ← RDMA/DPDK → [Matching Engine]
                                   ↓
                            [Ring Buffers]
                                   ↓
                        [Risk Engine (Rust)]
                                   ↓
                        [Market Data Feed]
```

## Deployment

- Bare metal deployment required
- NUMA-aware memory binding
- CPU pinning for core components
- Colocation with exchange switches

## Further Reading

- papers/firm/ - Academic papers on matching engine design
- docs/architecture/ - Detailed system specifications