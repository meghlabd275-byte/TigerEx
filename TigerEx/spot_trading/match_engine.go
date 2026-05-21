package main

func main() {
    println("TigerEx Spot Trading")
}

type Order struct {
    ID, UserID, Symbol, Side, Type string
    Quantity, Price float64
}

type Matcher struct {
    bids map[float64][]Order
    asks map[float64][]Order
}

func New() *Matcher { return &Matcher{bids: make(map[float64][]Order), asks: make(map[float64][]Order)} }

func (m *Matcher) Add(o Order) {
    if o.Side == "BUY" { m.bids[o.Price] = append(m.bids[o.Price], o)
    } else { m.asks[o.Price] = append(m.asks[o.Price], o) }
}