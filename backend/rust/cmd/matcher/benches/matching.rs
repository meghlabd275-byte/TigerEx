//! Throughput benchmarks for the matching engine.
//!
//! Run with: cargo bench --bench matching

use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};
use std::sync::Arc;
use tigerex_matcher::{Matcher, Order, OrderBook, Side};

fn order(id: String, side: Side, price: f64, quantity: f64) -> Order {
    Order::new(
        id,
        "bench".to_string(),
        "BTC/USDT".to_string(),
        side,
        price,
        quantity,
    )
}

/// Insert `depth` resting levels on each side, then cross them.
fn build_book(depth: usize) -> OrderBook {
    let mut book = OrderBook::new("BTC/USDT");
    for i in 0..depth {
        let offset = (i + 1) as f64;
        book.add_order(order(format!("bid{i}"), Side::Buy, 50_000.0 - offset, 1.0));
        book.add_order(order(format!("ask{i}"), Side::Sell, 50_000.0 + offset, 1.0));
    }
    book
}

fn bench_resting_insert(c: &mut Criterion) {
    let mut group = c.benchmark_group("resting_insert");
    group.throughput(Throughput::Elements(1));

    group.bench_function("1000_deep_book", |b| {
        let mut book = build_book(1_000);
        let mut counter = 0u64;
        b.iter(|| {
            counter += 1;
            // Insert below the best bid so it rests without trading.
            black_box(book.add_order(order(
                format!("new{counter}"),
                Side::Buy,
                49_000.0,
                1.0,
            )));
        });
    });
    group.finish();
}

fn bench_crossing_match(c: &mut Criterion) {
    let mut group = c.benchmark_group("crossing_match");
    group.throughput(Throughput::Elements(1));

    group.bench_function("single_level", |b| {
        let mut book = build_book(100);
        let mut counter = 0u64;
        b.iter(|| {
            counter += 1;
            black_box(book.add_order(order(
                format!("taker{counter}"),
                Side::Buy,
                50_001.0,
                1.0,
            )));
            // Replenish the level we just consumed.
            book.add_order(order(format!("rest{counter}"), Side::Sell, 50_001.0, 1.0));
        });
    });
    group.finish();
}

fn bench_sweep(c: &mut Criterion) {
    let mut group = c.benchmark_group("sweep");
    group.throughput(Throughput::Elements(50));

    group.bench_function("50_levels", |b| {
        b.iter_batched(
            || build_book(50),
            |mut book| {
                black_box(book.add_order(order(
                    "sweeper".to_string(),
                    Side::Buy,
                    50_100.0,
                    50.0,
                )));
            },
            criterion::BatchSize::SmallInput,
        );
    });
    group.finish();
}

fn bench_matcher_throughput(c: &mut Criterion) {
    let mut group = c.benchmark_group("matcher");
    group.throughput(Throughput::Elements(1_000));

    group.bench_function("1000_orders", |b| {
        let matcher = Arc::new(Matcher::new());
        let mut counter = 0u64;
        b.iter(|| {
            counter += 1;
            for i in 0..1_000 {
                let side = if i % 2 == 0 { Side::Buy } else { Side::Sell };
                black_box(matcher.add_order(order(
                    format!("o{counter}-{i}"),
                    side,
                    50_000.0,
                    1.0,
                )));
            }
        });
    });
    group.finish();
}

criterion_group!(
    benches,
    bench_resting_insert,
    bench_crossing_match,
    bench_sweep,
    bench_matcher_throughput
);
criterion_main!(benches);
