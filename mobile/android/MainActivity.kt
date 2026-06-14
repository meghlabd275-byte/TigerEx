package com.tigerex.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

// ============================================================================
// MAIN ACTIVITY
// ============================================================================

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TigerExTheme {
                MainScreen()
            }
        }
    }
}

// ============================================================================
// THEME
// ============================================================================

val TigerExColor = Color(0xFFF0B90B)

@Composable
fun TigerExTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = MaterialTheme.colors.copy(
            primary = TigerExColor,
            secondary = TigerExColor
        ),
        content = content
    )
}

// ============================================================================
// MAIN SCREEN
// ============================================================================

@OptIn(ExperimentalMaterialApi::class)
@Composable
fun MainScreen() {
    var selectedTab by remember { mutableStateOf(0) }
    
    Scaffold(
        bottomBar = {
            BottomNavigation(
                backgroundColor = MaterialTheme.colors.surface
            ) {
                BottomNavigationItem(
                    icon = { Text("Markets") },
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 }
                )
                BottomNavigationItem(
                    icon = { Text("Trade") },
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 }
                )
                BottomNavigationItem(
                    icon = { Text("Wallet") },
                    selected = selectedTab == 2,
                    onClick = { selectedTab = 2 }
                )
                BottomNavigationItem(
                    icon = { Text("Profile") },
                    selected = selectedTab == 3,
                    onClick = { selectedTab = 3 }
                )
            }
        }
    ) { padding ->
        when (selectedTab) {
            0 -> MarketsScreen()
            1 -> TradingScreen()
            2 -> WalletScreen()
            3 -> ProfileScreen()
        }
    }
}

// ============================================================================
// MARKETS SCREEN
// ============================================================================

@Composable
fun MarketsScreen() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Text(
            text = "Markets",
            style = MaterialTheme.typography.h5
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        
        val markets = listOf(
            Market("BTC/USDT", 50000.0, 2.5),
            Market("ETH/USDT", 3000.0, -1.2),
            Market("BNB/USDT", 600.0, 5.0),
            Market("SOL/USDT", 100.0, 3.5),
            Market("XRP/USDT", 0.50, -0.8)
        )
        
        markets.forEach { market ->
            MarketItem(market = market)
            Divider()
        }
    }
}

data class Market(
    val symbol: String,
    val price: Double,
    val change: Double
)

@Composable
fun MarketItem(market: Market) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column {
            Text(
                text = market.symbol,
                style = MaterialTheme.typography.body1
            )
            Text(
                text = formatPrice(market.price),
                style = MaterialTheme.typography.body2,
                color = Color.Gray
            )
        }
        
        Column(horizontalAlignment = androidx.compose.ui.Alignment.End) {
            Text(
                text = formatChange(market.change),
                style = MaterialTheme.typography.body1,
                color = if (market.change >= 0) Color.Green else Color.Red
            )
        }
    }
}

fun formatPrice(price: Double): String {
    return if (price >= 1000) {
        "$${String.format("%.2f", price)}"
    } else {
        "$${String.format("%.4f", price)}"
    }
}

fun formatChange(change: Double): String {
    val sign = if (change >= 0) "+" else ""
    return "$sign${String.format("%.2f", change)}%"
}

// ============================================================================
// TRADING SCREEN
// ============================================================================

@Composable
fun TradingScreen() {
    var orderType by remember { mutableStateOf(0) }
    var side by remember { mutableStateOf(0) }
    var price by remember { mutableStateOf("") }
    var quantity by remember { mutableStateOf("") }
    
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Text(
            text = "Trade",
            style = MaterialTheme.typography.h5
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        
        // Order type tabs
        TabRow(selectedTabIndex = orderType) {
            Tab(
                selected = orderType == 0,
                onClick = { orderType = 0 },
                text = { Text("Limit") }
            )
            Tab(
                selected = orderType == 1,
                onClick = { orderType = 1 },
                text = { Text("Market") }
            )
        }
        
        Spacer(modifier = Modifier.height(16.dp))
        
        // Buy/Sell tabs
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            Button(
                onClick = { side = 0 },
                colors = ButtonDefaults.buttonColors(
                    backgroundColor = if (side == 0) Color.Green else Color.Gray
                )
            ) {
                Text("Buy", color = Color.White)
            }
            
            Button(
                onClick = { side = 1 },
                colors = ButtonDefaults.buttonColors(
                    backgroundColor = if (side == 1) Color.Red else Color.Gray
                )
            ) {
                Text("Sell", color = Color.White)
            }
        }
        
        Spacer(modifier = Modifier.height(16.dp))
        
        // Price input (not for market orders)
        if (orderType != 1) {
            OutlinedTextField(
                value = price,
                onValueChange = { price = it },
                label = { Text("Price (USDT)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth()
            )
            
            Spacer(modifier = Modifier.height(8.dp))
        }
        
        // Quantity input
        OutlinedTextField(
            value = quantity,
            onValueChange = { quantity = it },
            label = { Text("Quantity") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth()
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        
        // Total
        Text(
            text = "Total: ${calculateTotal(price, quantity)} USDT",
            style = MaterialTheme.typography.body1
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        
        // Submit button
        Button(
            onClick = { /* Submit order */ },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(
                backgroundColor = if (side == 0) Color.Green else Color.Red
            )
        ) {
            Text(
                text = if (side == 0) "Buy" else "Sell",
                color = Color.White
            )
        }
    }
}

fun calculateTotal(price: String, quantity: String): String {
    val p = price.toDoubleOrNull() ?: 0.0
    val q = quantity.toDoubleOrNull() ?: 0.0
    return String.format("%.2f", p * q)
}

// ============================================================================
// WALLET SCREEN
// ============================================================================

@Composable
fun WalletScreen() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Text(
            text = "Wallet",
            style = MaterialTheme.typography.h5
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        
        val balances = listOf(
            Balance("USDT", 10000.0, 5000.0),
            Balance("BTC", 1.5, 0.5),
            Balance("ETH", 10.0, 2.0)
        )
        
        balances.forEach { balance ->
            BalanceItem(balance = balance)
            Divider()
        }
    }
}

data class Balance(
    val asset: String,
    val free: Double,
    val locked: Double
)

@Composable
fun BalanceItem(balance: Balance) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column {
            Text(
                text = balance.asset,
                style = MaterialTheme.typography.body1
            )
            Text(
                text = "${String.format("%.4f", balance.free)} available",
                style = MaterialTheme.typography.body2,
                color = Color.Gray
            )
        }
        
        Text(
            text = String.format("%.4f", balance.free + balance.locked),
            style = MaterialTheme.typography.body1
        )
    }
}

// ============================================================================
// PROFILE SCREEN
// ============================================================================

@Composable
fun ProfileScreen() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Text(
            text = "Profile",
            style = MaterialTheme.typography.h5
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        
        ListItem(
            text = "Security",
            icon = { Text("🔒") }
        )
        
        ListItem(
            text = "KYC Verification",
            icon = { Text("✓") }
        )
        
        ListItem(
            text = "API Keys",
            icon = { Text("🔑") }
        )
        
        ListItem(
            text = "Preferences",
            icon = { Text("⚙️") }
        )
        
        ListItem(
            text = "Help Center",
            icon = { Text("❓") }
        )
    }
}

@Composable
fun ListItem(text: String, icon: @Composable () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.body1
        )
        icon()
    }
}

// ============================================================================
// ANDROID MANIFEST
// ============================================================================

/*
AndroidManifest.xml would contain:
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.tigerex.mobile">
    
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="TigerEx"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.TigerEx">
        
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
*/