//! Integration tests for the order service.

use tigerex_order_service::{CreateOrderRequest, OrderService, OrderStatus, OrderType, Side};

fn request(side: &str, order_type: &str, price: f64, quantity: f64) -> CreateOrderRequest {
    CreateOrderRequest {
        user_id: "alice".to_string(),
        symbol: "BTC/USDT".to_string(),
        side: side.to_string(),
        order_type: order_type.to_string(),
        price,
        quantity,
        stop_price: None,
        time_in_force: None,
        client_order_id: None,
    }
}

#[test]
fn created_order_rests_open_and_unfilled() {
    let service = OrderService::new();
    let order = service
        .create_order(request("buy", "limit", 50_000.0, 2.0))
        .unwrap();

    assert_eq!(order.side, Side::Buy);
    assert_eq!(order.order_type, OrderType::Limit);
    assert_eq!(order.status, OrderStatus::Open);
    assert_eq!(order.filled_quantity, 0.0);
    assert_eq!(order.remaining(), 2.0);
    assert!(!order.is_filled());
}

#[test]
fn invalid_requests_are_rejected() {
    let service = OrderService::new();

    assert!(service
        .create_order(request("sideways", "limit", 1.0, 1.0))
        .is_err());
    assert!(service
        .create_order(request("buy", "nonsense", 1.0, 1.0))
        .is_err());
    assert!(service.create_order(request("buy", "limit", 0.0, 1.0)).is_err());
    assert!(service
        .create_order(request("buy", "limit", -5.0, 1.0))
        .is_err());
    assert!(service.create_order(request("buy", "limit", 1.0, 0.0)).is_err());

    // A market order legitimately carries no price.
    assert!(service
        .create_order(request("buy", "market", 0.0, 1.0))
        .is_ok());
}

#[test]
fn order_ids_are_unique() {
    let service = OrderService::new();
    let mut ids = std::collections::HashSet::new();

    for _ in 0..1_000 {
        let order = service
            .create_order(request("buy", "limit", 50_000.0, 1.0))
            .unwrap();
        assert!(ids.insert(order.id.clone()), "duplicate id {}", order.id);
    }
    assert_eq!(ids.len(), 1_000);
}

#[test]
fn orders_are_retrievable_per_user() {
    let service = OrderService::new();
    let order = service
        .create_order(request("buy", "limit", 50_000.0, 1.0))
        .unwrap();

    assert_eq!(service.get_order(&order.id).unwrap().id, order.id);

    let mine = service.get_user_orders("alice");
    assert_eq!(mine.len(), 1);
    assert!(service.get_user_orders("bob").is_empty());
    assert!(service.get_order("missing").is_none());
}

#[test]
fn partial_then_full_fill() {
    let service = OrderService::new();
    let order = service
        .create_order(request("buy", "limit", 50_000.0, 2.0))
        .unwrap();

    let partial = service.fill_order(&order.id, 0.5).unwrap();
    assert_eq!(partial.status, OrderStatus::PartiallyFilled);
    assert!((partial.remaining() - 1.5).abs() < 1e-9);

    let filled = service.fill_order(&order.id, 1.5).unwrap();
    assert_eq!(filled.status, OrderStatus::Filled);
    assert!(filled.is_filled());
    assert_eq!(filled.remaining(), 0.0);
}

#[test]
fn cannot_overfill_an_order() {
    let service = OrderService::new();
    let order = service
        .create_order(request("buy", "limit", 50_000.0, 1.0))
        .unwrap();

    assert!(service.fill_order(&order.id, 2.0).is_err());
    assert!(service.fill_order("missing", 1.0).is_err());
}

#[test]
fn a_resting_order_can_be_cancelled_once() {
    let service = OrderService::new();
    let order = service
        .create_order(request("buy", "limit", 50_000.0, 1.0))
        .unwrap();

    let cancelled = service.cancel_order(&order.id, "alice").unwrap();
    assert_eq!(cancelled.status, OrderStatus::Cancelled);

    // Cancelling twice fails.
    assert!(service.cancel_order(&order.id, "alice").is_err());
}

#[test]
fn a_user_cannot_cancel_someone_elses_order() {
    let service = OrderService::new();
    let order = service
        .create_order(request("buy", "limit", 50_000.0, 1.0))
        .unwrap();
    service.fill_order(&order.id, 0.5).unwrap();

    assert!(service.cancel_order(&order.id, "mallory").is_err());
    assert_eq!(
        service.get_order(&order.id).unwrap().status,
        OrderStatus::PartiallyFilled
    );
}

#[test]
fn open_orders_exclude_filled_and_cancelled() {
    let service = OrderService::new();

    let resting = service
        .create_order(request("buy", "limit", 50_000.0, 1.0))
        .unwrap();
    service.fill_order(&resting.id, 0.5).unwrap();

    let filled = service
        .create_order(request("sell", "limit", 51_000.0, 1.0))
        .unwrap();
    service.fill_order(&filled.id, 1.0).unwrap();

    let open = service.get_open_orders("alice");
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].id, resting.id);
}

#[test]
fn response_serialises_status_in_lowercase() {
    let service = OrderService::new();
    let order = service
        .create_order(request("sell", "stop_limit", 51_000.0, 1.0))
        .unwrap();

    let response = order.to_response();
    assert_eq!(response.side, "sell");
    assert_eq!(response.order_type, "stoplimit");
    assert_eq!(response.status, "open");
    assert_eq!(response.order_id, order.id);
}
