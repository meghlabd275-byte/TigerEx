# TigerEx Desktop Application

## Overview

Professional desktop trading application for Windows, macOS, and Linux.

## Features

### Trading
- Professional trading interface
- Multi-window support
- Multi-monitor support
- Real-time charts (TradingView integration)
- Advanced order types
- Grid trading
- DCA bot
- Copy trading

### Market Data
- Real-time price feeds
- Advanced charting
- Technical indicators
- Drawing tools
- Price alerts

### Portfolio
- Position tracking
- P&L analysis
- Tax reports
- Export data

### Security
- Hardware wallet support
- 2FA
- Anti-phishing
- Auto-lock

## Tech Stack

- Electron (for cross-platform)
- React + TypeScript
- Rust (for performance-critical features)
- WebSocket for real-time data

## Installation

### Windows
Download from: https://tigerex.com/download/windows

### macOS
Download from: https://tigerex.com/download/mac

### Linux
```bash
# Ubuntu/Debian
sudo dpkg -i tigerex.deb

# Fedora/RHEL
sudo rpm -i tigerex.rpm
```

## Development

```bash
# Install dependencies
npm install

# Run in development
npm run dev

# Build for production
npm run build
```

## Architecture

```
src/
├── main/           # Electron main process
├── renderer/       # React frontend
├── shared/         # Shared types
└── native/         # Rust native modules
```

## Key Components

### Main Process
- Window management
- System tray
- Auto-start
- Desktop notifications
- IPC handlers

### Renderer Process
- TradingView charts
- Order management
- Portfolio dashboard
- Settings

### Native Modules (Rust)
- Encryption
- Key storage
- Hardware wallet integration
