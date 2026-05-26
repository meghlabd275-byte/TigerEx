#!/usr/bin/env python3
"""API Handlers"""

from flask import Flask, jsonify, request
import time

app = Flask(__name__)

@app.route("/health")
def health():
    return jsonify({"status": "ok"})

@app.route("/api/v1/markets", methods=["GET"])
def markets():
    return jsonify({"markets": []})

@app.route("/api/v1/orders", methods=["POST"])
def create_order():
    data = request.json
    return jsonify({"order_id": "12345", "status": "accepted"})

@app.route("/api/v1/orders/<order_id>", methods=["GET"])
def get_order(order_id):
    return jsonify({"order_id": order_id, "status": "filled"})

@app.route("/api/v1/orders/<order_id>", methods=["DELETE"])
def cancel_order(order_id):
    return jsonify({"order_id": order_id, "status": "cancelled"})

@app.route("/api/v1/user/balance", methods=["GET"])
def balance():
    return jsonify({"BTC": "1.5", "USD": "50000"})

@app.route("/api/v1/deposit", methods=["POST"])
def deposit():
    return jsonify({"tx_hash": "abc123", "status": "confirmed"})

@app.route("/api/v1/withdraw", methods=["POST"])
def withdraw():
    return jsonify({"tx_hash": "def456", "status": "pending"})

if __name__ == "__main__":
    app.run(port=8080)