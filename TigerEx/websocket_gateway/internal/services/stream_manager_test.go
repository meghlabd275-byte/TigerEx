package services

import (
	"testing"

	"tigerex/websocket_gateway/internal/models"
)

func TestSubscribeRejectsUnknownStreamWithoutPartialMutation(t *testing.T) {
	manager := NewStreamManager()
	client := models.NewClient("client-1", "")
	if err := manager.Subscribe(client, []string{"btcusdt@trade", "unknown@ticker"}); err == nil {
		t.Fatal("expected unsupported stream to be rejected")
	}
	if len(client.Streams) != 0 {
		t.Fatalf("invalid subscription partially mutated client: %#v", client.Streams)
	}
	if manager.streams["btcusdt@trade"].Subscribed != 0 {
		t.Fatal("invalid subscription changed subscriber count")
	}
}

func TestSubscriptionCountsAreIdempotentAndUnsubscribeIsSafe(t *testing.T) {
	manager := NewStreamManager()
	client := models.NewClient("client-1", "")
	if err := manager.Subscribe(client, []string{"btcusdt@trade"}); err != nil { t.Fatal(err) }
	if err := manager.Subscribe(client, []string{"btcusdt@trade"}); err != nil { t.Fatal(err) }
	if got := manager.streams["btcusdt@trade"].Subscribed; got != 1 {
		t.Fatalf("duplicate subscription count = %d, want 1", got)
	}
	if err := manager.Unsubscribe(client, []string{"btcusdt@trade"}); err != nil { t.Fatal(err) }
	if err := manager.Unsubscribe(client, []string{"btcusdt@trade"}); err != nil { t.Fatal(err) }
	if got := manager.streams["btcusdt@trade"].Subscribed; got != 0 {
		t.Fatalf("unsubscribe count = %d, want 0", got)
	}
}

func TestGetStreamsReturnsDetachedValues(t *testing.T) {
	manager := NewStreamManager()
	streams := manager.GetStreams()
	if len(streams) == 0 { t.Fatal("expected configured stream catalog") }
	streams[0].Name = "mutated"
	for _, stream := range manager.GetStreams() {
		if stream.Name == "mutated" { t.Fatal("caller mutation changed manager stream catalog") }
	}
}
