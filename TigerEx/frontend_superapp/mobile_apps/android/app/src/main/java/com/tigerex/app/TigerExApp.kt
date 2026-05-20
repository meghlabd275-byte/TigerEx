package com.tigerex.app

import android.app.Application
import android.content.Context
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.soloader.SoLoader

class TigerExApp : Application(), ReactApplication {

    override val reactNativeHost: ReactNativeHost =
        object : DefaultReactNativeHost(this) {
            override fun getPackages(): List<ReactPackage> =
                PackageList(this).packages.apply {
                    // Add custom packages here
                }

            override fun getJSMainModuleName(): String = "index"

            override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

            override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
            override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
        }

    override val reactHost: ReactHost
        get() = getDefaultReactHost(applicationContext, reactNativeHost)

    override fun onCreate() {
        super.onCreate()
        SoLoader.init(this, false)
        if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
            DefaultNewArchitectureEntryPoint.load()
        }
    }
}

// ============================================================================
// Main Activity
// ============================================================================

package com.tigerex.app

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

    override fun getMainComponentName(): String = "TigerEx"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, DefaultNewArchitectureEntryPoint.load())
}

// ============================================================================
// Trading Screen (Composable)
// ============================================================================

package com.tigerex.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun TradingScreen(symbol: String) {
    var selectedTab by remember { mutableIntStateOf(0) }
    var price by remember { mutableStateOf("50000.00") }
    var quantity by remember { mutableStateOf("") }
    var isBuyOrder by remember { mutableStateOf(true) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("BTC/USDT") },
                actions = {
                    IconButton(onClick = { /* Settings */ }) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Price display
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "$${price}",
                        style = MaterialTheme.typography.h4
                    )
                    Text(
                        text = "+2.5% (24h)",
                        color = androidx.compose.ui.graphics.Color.Green
                    )
                }
            }

            // Buy/Sell tabs
            TabRow(selectedTabIndex = selectedTab) {
                Tab(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0; isBuyOrder = true },
                    text = { Text("Buy") }
                )
                Tab(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1; isBuyOrder = false },
                    text = { Text("Sell") }
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Order form
            OutlinedTextField(
                value = quantity,
                onValueChange = { quantity = it },
                label = { Text("Amount (BTC)") },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Quick amounts
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                listOf("25%", "50%", "75%", "100%").forEach { pct ->
                    OutlinedButton(
                        onClick = { /* Set percentage */ },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(pct)
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Submit button
            Button(
                onClick = { /* Submit order */ },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .height(56.dp),
                colors = ButtonDefaults.buttonColors(
                    backgroundColor = if (isBuyOrder) 
                        androidx.compose.ui.graphics.Color(0xFF22C55E)
                    else 
                        androidx.compose.ui.graphics.Color(0xFFEF4444)
                )
            ) {
                Text(
                    text = if (isBuyOrder) "Buy BTC" else "Sell BTC",
                    color = androidx.compose.ui.graphics.Color.White,
                    style = MaterialTheme.typography.titleMedium
                )
            }
        }
    }
}

// ============================================================================
// Wallet Screen
// ============================================================================

@Composable
fun WalletScreen() {
    val wallets = remember {
        listOf(
            Wallet("BTC", "0.5234", "26,170.00"),
            Wallet("ETH", "5.2", "12,480.00"),
            Wallet("USDT", "15,000.00", "15,000.00")
        )
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Total balance
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("Total Balance", style = MaterialTheme.typography.caption)
                Text("$53,650.00", style = MaterialTheme.typography.h3)
            }
        }

        // Wallet list
        wallets.forEach { wallet ->
            WalletItem(wallet = wallet)
        }
    }
}

data class Wallet(
    val symbol: String,
    val balance: String,
    val value: String
)

@Composable
fun WalletItem(wallet: Wallet) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(wallet.symbol, style = MaterialTheme.typography.titleMedium)
                Text("${wallet.balance} ${wallet.symbol}", style = MaterialTheme.typography.caption)
            }
            Text("$${wallet.value}", style = MaterialTheme.typography.titleMedium)
        }
    }
}