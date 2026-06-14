//
//  TigerEx iOS App
//  Native iOS trading application
//

import SwiftUI

// ============================================================================
// APP STRUCTURE
// ============================================================================

@main
struct TigerExApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var selectedTab = 0
    
    var body: some View {
        TabView(selection: $selectedTab) {
            MarketsView()
                .tabItem {
                    Label("Markets", systemImage: "chart.line.uptrend.xyaxis")
                }
                .tag(0)
            
            TradingView()
                .tabItem {
                    Label("Trade", systemImage: "arrow.left.arrow.right")
                }
                .tag(1)
            
            WalletView()
                .tabItem {
                    Label("Wallet", systemImage: "wallet.pass")
                }
                .tag(2)
            
            ProfileView()
                .tabItem {
                    Label("Profile", systemImage: "person.circle")
                }
                .tag(3)
        }
        .accentColor(Color(hex: "F0B90B"))
    }
}

// ============================================================================
// MARKETS VIEW
// ============================================================================

struct MarketsView: View {
    @State private var searchText = ""
    @State private var selectedSegment = 0
    
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Search bar
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundColor(.gray)
                    TextField("Search markets", text: $searchText)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                }
                .padding()
                
                // Segment control
                Picker("Filter", selection: $selectedSegment) {
                    Text("All").tag(0)
                    Text("Favorites").tag(1)
                    Text("Gainers").tag(2)
                    Text("Losers").tag(3)
                }
                .pickerStyle(SegmentedPickerStyle())
                .padding(.horizontal)
                
                // Markets list
                List {
                    ForEach(markets, id: \.symbol) { market in
                        MarketRow(market: market)
                    }
                }
                .listStyle(PlainListStyle())
            }
            .navigationTitle("Markets")
        }
    }
    
    var markets: [Market] {
        [
            Market(symbol: "BTC/USDT", price: 50000.00, change: 2.5),
            Market(symbol: "ETH/USDT", price: 3000.00, change: -1.2),
            Market(symbol: "BNB/USDT", price: 600.00, change: 5.0),
            Market(symbol: "SOL/USDT", price: 100.00, change: 3.5),
            Market(symbol: "XRP/USDT", price: 0.50, change: -0.8),
        ]
    }
}

struct Market: Identifiable {
    let id = UUID()
    let symbol: String
    let price: Double
    let change: Double
}

struct MarketRow: View {
    let market: Market
    
    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text(market.symbol)
                    .font(.headline)
                Text(formatPrice(market.price))
                    .font(.subheadline)
                    .foregroundColor(.gray)
            }
            
            Spacer()
            
            VStack(alignment: .trailing) {
                Text(formatChange(market.change))
                    .font(.headline)
                    .foregroundColor(market.change >= 0 ? .green : .red)
            }
        }
        .padding(.vertical, 8)
    }
    
    func formatPrice(_ price: Double) -> String {
        if price >= 1000 {
            return String(format: "$%.2f", price)
        } else {
            return String(format: "$%.4f", price)
        }
    }
    
    func formatChange(_ change: Double) -> String {
        let sign = change >= 0 ? "+" : ""
        return String(format: "%@%.2f%%", sign, change)
    }
}

// ============================================================================
// TRADING VIEW
// ============================================================================

struct TradingView: View {
    @State private var selectedSymbol = "BTC/USDT"
    @State private var orderType = 0
    @State private var side = 0
    @State private var price = ""
    @State private var quantity = ""
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // Symbol selector
                    HStack {
                        Text(selectedSymbol)
                            .font(.title2)
                            .fontWeight(.bold)
                        Spacer()
                    }
                    .padding()
                    
                    // Order type picker
                    Picker("Order Type", selection: $orderType) {
                        Text("Limit").tag(0)
                        Text("Market").tag(1)
                        Text("Stop-Limit").tag(2)
                    }
                    .pickerStyle(SegmentedPickerStyle())
                    .padding(.horizontal)
                    
                    // Side picker
                    Picker("Side", selection: $side) {
                        Text("Buy").tag(0)
                        Text("Sell").tag(1)
                    }
                    .pickerStyle(SegmentedPickerStyle())
                    .padding(.horizontal)
                    
                    // Price input
                    if orderType != 1 {
                        VStack(alignment: .leading) {
                            Text("Price (USDT)")
                                .font(.caption)
                                .foregroundColor(.gray)
                            TextField("0.00", text: $price)
                                .keyboardType(.decimalPad)
                                .textFieldStyle(RoundedBorderTextFieldStyle())
                        }
                        .padding(.horizontal)
                    }
                    
                    // Quantity input
                    VStack(alignment: .leading) {
                        Text("Quantity")
                            .font(.caption)
                            .foregroundColor(.gray)
                        TextField("0.00", text: $quantity)
                            .keyboardType(.decimalPad)
                            .textFieldStyle(RoundedBorderTextFieldStyle())
                    }
                    .padding(.horizontal)
                    
                    // Total
                    HStack {
                        Text("Total")
                            .foregroundColor(.gray)
                        Spacer()
                        Text(calculateTotal())
                            .fontWeight(.bold)
                    }
                    .padding()
                    
                    // Submit button
                    Button(action: submitOrder) {
                        Text(side == 0 ? "Buy" : "Sell")
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(side == 0 ? Color.green : Color.red)
                            .cornerRadius(10)
                    }
                    .padding()
                }
            }
            .navigationTitle("Trade")
        }
    }
    
    func calculateTotal() -> String {
        guard let p = Double(price), let q = Double(quantity) else {
            return "0.00 USDT"
        }
        return String(format: "%.2f USDT", p * q)
    }
    
    func submitOrder() {
        // Submit order logic
    }
}

// ============================================================================
// WALLET VIEW
// ============================================================================

struct WalletView: View {
    var body: some View {
        NavigationView {
            List {
                ForEach(balances, id: \.asset) { balance in
                    BalanceRow(balance: balance)
                }
            }
            .navigationTitle("Wallet")
        }
    }
    
    var balances: [Balance] {
        [
            Balance(asset: "USDT", free: 10000.0, locked: 5000.0),
            Balance(asset: "BTC", free: 1.5, locked: 0.5),
            Balance(asset: "ETH", free: 10.0, locked: 2.0),
        ]
    }
}

struct Balance: Identifiable {
    let id = UUID()
    let asset: String
    let free: Double
    let locked: Double
}

struct BalanceRow: View {
    let balance: Balance
    
    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text(balance.asset)
                    .font(.headline)
                Text(String(format: "%.4f available", balance.free))
                    .font(.caption)
                    .foregroundColor(.gray)
            }
            
            Spacer()
            
            VStack(alignment: .trailing) {
                Text(String(format: "%.4f", balance.free + balance.locked))
                    .font(.headline)
            }
        }
        .padding(.vertical, 8)
    }
}

// ============================================================================
// PROFILE VIEW
// ============================================================================

struct ProfileView: View {
    var body: some View {
        NavigationView {
            List {
                Section("Account") {
                    NavigationLink("Security") {
                        SecurityView()
                    }
                    NavigationLink("KYC Verification") {
                        KYCView()
                    }
                    NavigationLink("API Keys") {
                        APIKeysView()
                    }
                }
                
                Section("Settings") {
                    NavigationLink("Preferences") {
                        PreferencesView()
                    }
                    NavigationLink("Notifications") {
                        NotificationsView()
                    }
                }
                
                Section("Support") {
                    NavigationLink("Help Center") {
                        HelpView()
                    }
                    NavigationLink("Contact Us") {
                        ContactView()
                    }
                }
            }
            .navigationTitle("Profile")
        }
    }
}

struct SecurityView: View {
    var body: some View {
        VStack {
            Text("Security Settings")
        }
    }
}

struct KYCView: View {
    var body: some View {
        VStack {
            Text("KYC Status: Verified")
        }
    }
}

struct APIKeysView: View {
    var body: some View {
        VStack {
            Text("API Keys Management")
        }
    }
}

struct PreferencesView: View {
    var body: some View {
        VStack {
            Text("Preferences")
        }
    }
}

struct NotificationsView: View {
    var body: some View {
        VStack {
            Text("Notifications")
        }
    }
}

struct HelpView: View {
    var body: some View {
        VStack {
            Text("Help Center")
        }
    }
}

struct ContactView: View {
    var body: some View {
        VStack {
            Text("Contact Us")
        }
    }
}

// ============================================================================
// COLOR EXTENSION
// ============================================================================

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue:  Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}