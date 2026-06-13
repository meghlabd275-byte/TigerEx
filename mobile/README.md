# TigerEx Mobile Applications

## iOS App Structure

```
ios/
├── App/
│   ├── TigerExApp.swift
│   ├── AppDelegate.swift
│   └── SceneDelegate.swift
├── Screens/
│   ├── Splash/
│   ├── Auth/
│   │   ├── LoginViewController.swift
│   │   ├── RegisterViewController.swift
│   │   ├── ForgotPasswordViewController.swift
│   │   └── TwoFactorViewController.swift
│   ├── Home/
│   │   └── HomeViewController.swift
│   ├── Markets/
│   │   ├── MarketsViewController.swift
│   │   ├── MarketDetailViewController.swift
│   │   └── TradingViewController.swift
│   ├── Wallet/
│   │   ├── WalletViewController.swift
│   │   ├── DepositViewController.swift
│   │   ├── WithdrawViewController.swift
│   │   └── TransferViewController.swift
│   ├── Earn/
│   │   ├── EarnViewController.swift
│   │   ├── StakingViewController.swift
│   │   ├── SavingsViewController.swift
│   │   └── LendingViewController.swift
│   ├── P2P/
│   │   ├── P2PViewController.swift
│   │   ├── BuyViewController.swift
│   │   └── SellViewController.swift
│   ├── Profile/
│   │   ├── ProfileViewController.swift
│   │   ├── SecurityViewController.swift
│   │   ├── KYCViewController.swift
│   │   └── SettingsViewController.swift
│   └── Settings/
│       └── SettingsViewController.swift
├── Views/
│   ├── Cells/
│   ├── Charts/
│   ├── Components/
│   └── Custom/
├── Services/
│   ├── APIService.swift
│   ├── WebSocketService.swift
│   ├── AuthService.swift
│   ├── TradingService.swift
│   ├── WalletService.swift
│   └── SecurityService.swift
├── Models/
├── Utils/
│   ├── Extensions/
│   ├── Constants.swift
│   └── Helpers/
├── Resources/
│   ├── Assets.xcassets/
│   ├── LaunchScreen.storyboard
│   └── Info.plist
└── Supporting Files/
```

## Android App Structure

```
android/
├── app/
│   ├── src/main/
│   │   ├── java/com/tigerex/app/
│   │   │   ├── TigerExApplication.kt
│   │   │   ├── MainActivity.kt
│   │   │   ├── di/ (Dependency Injection)
│   │   │   ├── data/ (Repository, API)
│   │   │   ├── domain/ (Use cases)
│   │   │   ├── ui/ (Activities, Fragments)
│   │   │   └── util/ (Utils)
│   │   └── res/
│   │       ├── layout/
│   │       ├── values/
│   │       ├── drawable/
│   │       └── navigation/
│   └── build.gradle
├── gradle/
└── build.gradle
```

## Features

### Authentication
- Email/Password login
- Phone number login
- Biometric authentication (Face ID, Touch ID, Fingerprint)
- Two-factor authentication (SMS, Authenticator)
- Social login (Google, Apple)
- Wallet connect

### Trading
- Spot trading
- Margin trading
- Futures trading
- Options trading
- Stop-loss, Stop-limit orders
- Trailing stop
- OCO orders
- Grid trading
- DCA bot

### Wallet
- Multi-currency wallet
- Deposit (Crypto, Fiat)
- Withdraw (Crypto, Fiat)
- Internal transfer
- Address book
- Whitelist management

### Earn Products
- Staking (ETH 2.0, DOT, SOL, etc.)
- Savings
- Lending
- Liquidity mining

### P2P Trading
- Buy/Sell crypto with fiat
- Multiple payment methods
- Escrow protection
- Dispute resolution

### Security
- 2FA
- Anti-phishing code
- Withdrawal whitelist
- IP whitelist
- Login alerts
- Device management

## Tech Stack

### iOS
- Swift 5.9+
- UIKit + SnapKit
- Combine for reactive
- Apollo for GraphQL

### Android
- Kotlin 1.9+
- Jetpack Compose
- Hilt for DI
- Coroutines + Flow
- Retrofit for networking

## Build

### iOS
```bash
cd ios
pod install
open TigerEx.xcworkspace
```

### Android
```bash
cd android
./gradlew assembleDebug
```

## API Integration

Both apps use the same REST and WebSocket API:
- Base URL: https://api.tigerex.com
- WebSocket: wss://ws.tigerex.com

## Security

- Certificate pinning
- Encrypted SharedPreferences
- Biometric unlock
- Auto-logout
- Session management
