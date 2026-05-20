//
//  TigerEx iOS App
//  Swift trading application
//

import SwiftUI

// ============================================================================
// App Entry Point
// ============================================================================

@main
struct TigerExApp: App {
    @StateObject private var authManager = AuthManager()
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(authManager)
        }
    }
}

// ============================================================================
// Auth Manager
// ============================================================================

class AuthManager: ObservableObject {
    @Published var isAuthenticated = false
    @Published var user: User?
    
    func login(email: String, password: String) async {
        // API call
    }
    
    func logout() {
        isAuthenticated = false
        user = nil
    }
}

struct User: Codable {
    let id: String
    let email: String
    let kycStatus: String
}

// ============================================================================
// Main Content View
// ============================================================================

struct ContentView: View {
    @EnvironmentObject var authManager: AuthManager
    
    var body: some View {
        Group {
            if authManager.isAuthenticated {
                MainTabView()
            } else {
                LoginView()
            }
        }
    }
}

// ============================================================================
// Login View
// ============================================================================

struct LoginView: View {
    @State private var email = ""
    @State private var password = ""
    @State private var isLoading = false
    @EnvironmentObject var authManager: AuthManager
    
    var body: some View {
        NavigationView {
            VStack(spacing: 20) {
                // Logo
                Text("TigerEx")
                    .font(.largeTitle)
                    .fontWeight(.bold)
                
                // Email
                TextField("Email", text: $email)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                    .autocapitalization(.none)
                    .keyboardType(.emailAddress)
                
                // Password
                SecureField("Password", text: $password)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                
                // Login Button
                Button(action: {
                    isLoading = true
                    Task {
                        await authManager.login(email: email, password: password)
                        isLoading = false
                    }
                }) {
                    if isLoading {
                        ProgressView()
                            .foregroundColor(.white)
                    } else {
                        Text("Login")
                            .foregroundColor(.white)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.blue)
                .cornerRadius(10)
                
                // Biometric Login
                Button(action: { /* Biometric */ }) {
                    HStack {
                        Image(systemName: "faceid")
                        Text("Login with Face ID")
                    }
                }
            }
            .padding()
        }
    }
}

// ============================================================================
// Main Tab View
// ============================================================================

struct MainTabView: View {
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
                    Label("Wallet", systemImage: "creditcard")
                }
                .tag(2)
            
            ProfileView()
                .tabItem {
                    Label("Profile", systemImage: "person.circle")
                }
                .tag(3)
        }
    }
}

// ============================================================================
// Markets View
// ============================================================================

struct MarketsView: View {
    let pairs = [
        MarketPair(symbol: "BTC/USDT", price: 50000, change: 2.5),
        MarketPair(symbol: "ETH/USDT", price: 2800, change: -1.2),
        MarketPair(symbol: "SOL/USDT", price: 120, change: 5.8),
        MarketPair(symbol: "BNB/USDT", price: 420, change: 0.5)
    ]
    
    var body: some View {
        NavigationView {
            List(pairs, id: \.symbol) { pair in
                NavigationLink(destination: TradingView(symbol: pair.symbol)) {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(pair.symbol)
                                .font(.headline)
                            Text("$${pair.price, specifier: "%.2f"}")
                                .foregroundColor(.gray)
                        }
                        Spacer()
                        Text("\(pair.change, specifier: "%.2f")%")
                            .foregroundColor(pair.change >= 0 ? .green : .red)
                            .fontWeight(.bold)
                    }
                }
            }
            .navigationTitle("Markets")
        }
    }
}

struct MarketPair: Identifiable {
    let id = UUID()
    let symbol: String
    let price: Double
    let change: Double
}

// ============================================================================
// Trading View
// ============================================================================

struct TradingView: View {
    let symbol: String
    @State private var price = "50000.00"
    @State private var amount = ""
    @State private var isBuyOrder = true
    
    var body: some View {
        VStack(spacing: 20) {
            // Price
            VStack(spacing: 4) {
                Text("$\(price)")
                    .font(.system(size: 40, weight: .bold))
                Text("+2.50% (24h)")
                    .foregroundColor(.green)
            }
            .padding()
            
            // Buy/Sell Toggle
            HStack(spacing: 0) {
                Button(action: { isBuyOrder = true }) {
                    Text("Buy")
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(isBuyOrder ? Color.green : Color.gray.opacity(0.2))
                        .foregroundColor(.white)
                }
                Button(action: { isBuyOrder = false }) {
                    Text("Sell")
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(isBuyOrder ? Color.gray.opacity(0.2) : Color.red)
                        .foregroundColor(.white)
                }
            }
            .cornerRadius(10)
            .padding(.horizontal)
            
            // Amount Input
            VStack(alignment: .leading) {
                Text("Amount (BTC)")
                    .font(.caption)
                    .foregroundColor(.gray)
                TextField("0.00", text: $amount)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
            }
            .padding(.horizontal)
            
            // Quick Amounts
            HStack(spacing: 8) {
                ForEach(["25%", "50%", "75%", "100%"], id: \.self) { pct in
                    Button(action: { /* Set percentage */ }) {
                        Text(pct)
                            .frame(maxWidth: .infinity)
                            .padding(8)
                            .background(Color.gray.opacity(0.2))
                            .cornerRadius(5)
                    }
                    .foregroundColor(.primary)
                }
            }
            .padding(.horizontal)
            
            // Submit Button
            Button(action: { /* Submit */ }) {
                Text(isBuyOrder ? "Buy \(symbol)" : "Sell \(symbol)")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(isBuyOrder ? Color.green : Color.red)
                    .foregroundColor(.white)
                    .cornerRadius(10)
            }
            .padding(.horizontal)
            
            Spacer()
        }
        .navigationTitle(symbol)
    }
}

// ============================================================================
// Wallet View
// ============================================================================

struct WalletView: View {
    let wallets = [
        WalletBalance(symbol: "BTC", balance: "0.5234", value: 26170.00),
        WalletBalance(symbol: "ETH", balance: "5.2000", value: 14560.00),
        WalletBalance(symbol: "USDT", balance: "15000.00", value: 15000.00)
    ]
    
    var body: some View {
        NavigationView {
            VStack(spacing: 16) {
                // Total Balance
                VStack(spacing: 4) {
                    Text("Total Balance")
                        .font(.caption)
                        .foregroundColor(.gray)
                    Text("$55,670.00")
                        .font(.system(size: 36, weight: .bold))
                }
                .padding()
                
                // Wallet List
                List(wallets, id: \.symbol) { wallet in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(wallet.symbol)
                                .font(.headline)
                            Text(wallet.balance)
                                .foregroundColor(.gray)
                        }
                        Spacer()
                        Text("$\(wallet.value, specifier: "%.2f")")
                            .font(.headline)
                    }
                }
                .listStyle(PlainListStyle())
            }
            .navigationTitle("Wallet")
        }
    }
}

struct WalletBalance: Identifiable {
    let id = UUID()
    let symbol: String
    let balance: String
    let value: Double
}

// ============================================================================
// Profile View
// ============================================================================

struct ProfileView: View {
    @EnvironmentObject var authManager: AuthManager
    
    var body: some View {
        NavigationView {
            List {
                Section("Account") {
                    NavigationLink(destination: Text("KYC")) {
                        Label("KYC Verification", systemImage: "person.badge.shield.checkmark")
                    }
                    NavigationLink(destination: Text("Security")) {
                        Label("Security", systemImage: "lock.shield")
                    }
                }
                
                Section("Preferences") {
                    NavigationLink(destination: Text("Theme")) {
                        Label("Theme", systemImage: "paintbrush")
                    }
                    NavigationLink(destination: Text("Language")) {
                        Label("Language", systemImage: "globe")
                    }
                }
                
                Section {
                    Button(action: { authManager.logout() }) {
                        Label("Logout", systemImage: "rectangle.portrait.and.arrow.right")
                            .foregroundColor(.red)
                    }
                }
            }
            .navigationTitle("Profile")
        }
    }
}