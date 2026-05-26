package com.tigerex.api;

public class ApiResponse<T> {
    private T data;
    private String status;
    private long timestamp;
    
    public ApiResponse(T data) {
        this.data = data;
        this.status = "success";
        this.timestamp = System.currentTimeMillis();
    }
    
    public T getData() { return data; }
    public String getStatus() { return status; }
    public long getTimestamp() { return timestamp; }
    
    public static <T> ApiResponse<T> success(T data) {
        return new ApiResponse<>(data);
    }
}