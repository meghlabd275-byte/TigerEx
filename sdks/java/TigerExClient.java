package com.tigerex.sdk;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * TigerEx Java SDK
 * Production-grade Java SDK for TigerEx exchange API
 */
public class TigerExClient {
    
    private final String apiKey;
    private final String apiSecret;
    private final String baseUrl;
    private final int timeout;
    
    public TigerExClient(String apiKey, String apiSecret) {
        this(apiKey, apiSecret, false, 30000);
    }
    
    public TigerExClient(String apiKey, String apiSecret, boolean testnet, int timeout) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.baseUrl = testnet ? "https://api-test.tigerex.com" : "https://api.tigerex.com";
        this.timeout = timeout;
    }
    
    // =========================================================================
    // PRIVATE METHODS
    // =========================================================================
    
    private String sign(String message) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        SecretKeySpec secretKey = new SecretKeySpec(apiSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        mac.init(secretKey);
        byte[] hash = mac.doFinal(message.getBytes(StandardCharsets.UTF_8));
        return bytesToHex(hash);
    }
    
    private String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
    
    private String buildQueryString(Map<String, String> params) {
        List<String> keys = new ArrayList<>(params.keySet());
        Collections.sort(keys);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < keys.size(); i++) {
            String key = keys.get(i);
            if (i > 0) sb.append("&");
            sb.append(key).append("=").append(params.get(key));
        }
        return sb.toString();
    }
    
    private String request(String method, String endpoint, Map<String, String> params, boolean signed) throws Exception {
        long timestamp = System.currentTimeMillis();
        String queryString = buildQueryString(params);
        
        String url = baseUrl + endpoint;
        if (method.equals("GET") && !queryString.isEmpty()) {
            url += "?" + queryString;
        }
        
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod(method);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("User-Agent", "TigerEx-Java-SDK/1.0.0");
        
        if (!apiKey.isEmpty()) {
            conn.setRequestProperty("X-MEX-APIKEY", apiKey);
        }
        
        if (signed) {
            String signature = sign(queryString + "&timestamp=" + timestamp);
            conn.setRequestProperty("X-MEX-SIGNATURE", signature);
        }
        
        if (method.equals("POST") || method.equals("PUT")) {
            conn.setDoOutput(true);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(queryString.getBytes(StandardCharsets.UTF_8));
            }
        }
        
        int responseCode = conn.getResponseCode();
        BufferedReader reader = new BufferedReader(
            new InputStreamReader(
                responseCode >= 200 && responseCode < 300 
                    ? conn.getInputStream() 
                    : conn.getErrorStream(),
                StandardCharsets.UTF_8
            )
        );
        
        StringBuilder response = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            response.append(line);
        }
        reader.close();
        
        return response.toString();
    }
    
    // =========================================================================
    // MARKET DATA
    // =========================================================================
    
    public String ping() throws Exception {
        return request("GET", "/api/v3/ping", new HashMap<>(), false);
    }
    
    public String time() throws Exception {
        return request("GET", "/api/v3/time", new HashMap<>(), false);
    }
    
    public String exchangeInfo(String symbol) throws Exception {
        Map<String, String> params = new HashMap<>();
        if (symbol != null && !symbol.isEmpty()) {
            params.put("symbol", symbol);
        }
        return request("GET", "/api/v3/exchangeInfo", params, false);
    }
    
    public String tickerPrice(String symbol) throws Exception {
        return request("GET", "/api/v3/ticker/price", Map.of("symbol", symbol), false);
    }
    
    public String ticker24h(String symbol) throws Exception {
        Map<String, String> params = new HashMap<>();
        if (symbol != null && !symbol.isEmpty()) {
            params.put("symbol", symbol);
        }
        return request("GET", "/api/v3/ticker/24hr", params, false);
    }
    
    public String bookTicker(String symbol) throws Exception {
        return request("GET", "/api/v3/ticker/bookTicker", Map.of("symbol", symbol), false);
    }
    
    public String depth(String symbol, int limit) throws Exception {
        return request("GET", "/api/v3/depth", Map.of("symbol", symbol, "limit", String.valueOf(limit)), false);
    }
    
    public String trades(String symbol, int limit) throws Exception {
        return request("GET", "/api/v3/trades", Map.of("symbol", symbol, "limit", String.valueOf(limit)), false);
    }
    
    public String klines(String symbol, String interval, int limit) throws Exception {
        return request("GET", "/api/v3/klines", Map.of(
            "symbol", symbol,
            "interval", interval,
            "limit", String.valueOf(limit)
        ), false);
    }
    
    public String avgPrice(String symbol, int minutes) throws Exception {
        return request("GET", "/api/v3/avgPrice", Map.of("symbol", symbol, "minutes", String.valueOf(minutes)), false);
    }
    
    // =========================================================================
    // ACCOUNT
    // =========================================================================
    
    public String account() throws Exception {
        return request("GET", "/api/v3/account", new HashMap<>(), true);
    }
    
    public String myTrades(String symbol, Map<String, String> options) throws Exception {
        Map<String, String> params = new HashMap<>();
        params.put("symbol", symbol);
        if (options != null) params.putAll(options);
        return request("GET", "/api/v3/myTrades", params, true);
    }
    
    // =========================================================================
    // ORDERS
    // =========================================================================
    
    public String order(String symbol, Long orderId, String origClientOrderId) throws Exception {
        Map<String, String> params = new HashMap<>();
        params.put("symbol", symbol);
        if (orderId != null) params.put("orderId", String.valueOf(orderId));
        if (origClientOrderId != null) params.put("origClientOrderId", origClientOrderId);
        return request("GET", "/api/v3/order", params, true);
    }
    
    public String openOrders(String symbol) throws Exception {
        Map<String, String> params = new HashMap<>();
        if (symbol != null && !symbol.isEmpty()) {
            params.put("symbol", symbol);
        }
        return request("GET", "/api/v3/openOrders", params, true);
    }
    
    public String allOrders(String symbol, Map<String, String> options) throws Exception {
        Map<String, String> params = new HashMap<>();
        params.put("symbol", symbol);
        if (options != null) params.putAll(options);
        return request("GET", "/api/v3/allOrders", params, true);
    }
    
    public String createOrder(Map<String, String> order) throws Exception {
        return request("POST", "/api/v3/order", order, true);
    }
    
    public String cancelOrder(String symbol, Long orderId, String origClientOrderId) throws Exception {
        Map<String, String> params = new HashMap<>();
        params.put("symbol", symbol);
        if (orderId != null) params.put("orderId", String.valueOf(orderId));
        if (origClientOrderId != null) params.put("origClientOrderId", origClientOrderId);
        return request("DELETE", "/api/v3/order", params, true);
    }
    
    // =========================================================================
    // CONVENIENCE METHODS
    // =========================================================================
    
    public String buyLimit(String symbol, double quantity, double price, Map<String, String> options) throws Exception {
        Map<String, String> order = new HashMap<>();
        order.put("symbol", symbol);
        order.put("side", "BUY");
        order.put("type", "LIMIT");
        order.put("quantity", String.valueOf(quantity));
        order.put("price", String.valueOf(price));
        if (options != null) order.putAll(options);
        return createOrder(order);
    }
    
    public String sellLimit(String symbol, double quantity, double price, Map<String, String> options) throws Exception {
        Map<String, String> order = new HashMap<>();
        order.put("symbol", symbol);
        order.put("side", "SELL");
        order.put("type", "LIMIT");
        order.put("quantity", String.valueOf(quantity));
        order.put("price", String.valueOf(price));
        if (options != null) order.putAll(options);
        return createOrder(order);
    }
    
    public String buyMarket(String symbol, double quantity, Map<String, String> options) throws Exception {
        Map<String, String> order = new HashMap<>();
        order.put("symbol", symbol);
        order.put("side", "BUY");
        order.put("type", "MARKET");
        order.put("quantity", String.valueOf(quantity));
        if (options != null) order.putAll(options);
        return createOrder(order);
    }
    
    public String sellMarket(String symbol, double quantity, Map<String, String> options) throws Exception {
        Map<String, String> order = new HashMap<>();
        order.put("symbol", symbol);
        order.put("side", "SELL");
        order.put("type", "MARKET");
        order.put("quantity", String.valueOf(quantity));
        if (options != null) order.putAll(options);
        return createOrder(order);
    }
    
    // =========================================================================
    // WALLET
    // =========================================================================
    
    public String depositAddress(String coin, String network) throws Exception {
        Map<String, String> params = new HashMap<>();
        params.put("coin", coin);
        if (network != null && !network.isEmpty()) {
            params.put("network", network);
        }
        return request("GET", "/api/v3/deposit/address", params, true);
    }
    
    public String depositHistory(Map<String, String> options) throws Exception {
        return request("GET", "/api/v3/deposit/history", options != null ? options : new HashMap<>(), true);
    }
    
    public String withdraw(String coin, String address, double amount, String network) throws Exception {
        Map<String, String> params = new HashMap<>();
        params.put("coin", coin);
        params.put("address", address);
        params.put("amount", String.valueOf(amount));
        if (network != null && !network.isEmpty()) {
            params.put("network", network);
        }
        return request("POST", "/api/v3/withdraw/apply", params, true);
    }
    
    public String withdrawHistory(Map<String, String> options) throws Exception {
        return request("GET", "/api/v3/withdraw/history", options != null ? options : new HashMap<>(), true);
    }
    
    // =========================================================================
    // MARGIN
    // =========================================================================
    
    public String marginAccount() throws Exception {
        return request("GET", "/sapi/v3/margin/account", new HashMap<>(), true);
    }
    
    public String createMarginOrder(Map<String, String> order) throws Exception {
        return request("POST", "/sapi/v3/margin/order", order, true);
    }
    
    // =========================================================================
    // FUTURES
    // =========================================================================
    
    public String futuresAccount() throws Exception {
        return request("GET", "/fapi/v3/account", new HashMap<>(), true);
    }
    
    public String futuresPosition(String symbol) throws Exception {
        Map<String, String> params = new HashMap<>();
        if (symbol != null && !symbol.isEmpty()) {
            params.put("symbol", symbol);
        }
        return request("GET", "/fapi/v3/position", params, true);
    }
    
    public String createFuturesOrder(Map<String, String> order) throws Exception {
        return request("POST", "/fapi/v3/order", order, true);
    }
    
    // =========================================================================
    // MAIN
    // =========================================================================
    
    public static void main(String[] args) {
        try {
            TigerExClient client = new TigerExClient("test_key", "test_secret", true);
            
            // Test ping
            System.out.println("Ping: " + client.ping());
            
            // Test time
            System.out.println("Time: " + client.time());
            
            // Test ticker
            System.out.println("Ticker: " + client.tickerPrice("BTCUSDT"));
            
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}