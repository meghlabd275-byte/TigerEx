"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Gift, RefreshCw, CheckCircle, Users } from "lucide-react";
import { useApiResource, toArray } from "@/lib/useApiResource";

interface RedPacket {
  id: string;
  creator_id?: string;
  asset?: string;
  amount?: number;
  quantity?: number;
  type?: string;
  claimed?: number;
  remaining?: number;
  status?: string;
  message?: string;
  expires_at?: string;
}

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string | { message?: string };
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return "";
}

function unwrap<T>(payload: unknown): T | null {
  if (!payload || typeof payload !== "object") return null;
  const envelope = payload as ApiEnvelope<T>;
  if (envelope.data !== undefined) return envelope.data;
  return payload as T;
}

export default function RedPacketPage() {
  const packets = useApiResource<unknown>("/api/redpacket/list");
  const [mode, setMode] = useState<"create" | "receive">("receive");
  const [asset, setAsset] = useState("USDT");
  const [packetType, setPacketType] = useState<"random" | "average">("random");
  const [amount, setAmount] = useState("");
  const [count, setCount] = useState("10");
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const list = useMemo(() => toArray<RedPacket>(packets.data), [packets.data]);

  const authedFetch = (url: string, body: unknown) => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("tigerex_access_token") : null;
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  };

  const createPacket = async () => {
    setResult(null);
    setBusy(true);
    try {
      const response = await authedFetch("/api/redpacket", {
        asset,
        type: packetType,
        message,
        amount: Number(amount),
        quantity: Number(count),
      });
      const data = (await response.json()) as ApiEnvelope<RedPacket>;
      if (response.ok && data.success !== false) {
        setResult({
          ok: true,
          message: `Red packet created${data.data?.id ? ` — share code ${data.data.id}` : ""}.`,
        });
        setAmount("");
        setMessage("");
        packets.reload();
      } else {
        setResult({
          ok: false,
          message: errorText(data.error) || "Could not create the red packet.",
        });
      }
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : "Could not create the red packet.",
      });
    } finally {
      setBusy(false);
    }
  };

  const claimPacket = async () => {
    setResult(null);
    setBusy(true);
    try {
      const response = await authedFetch("/api/redpacket/claim", { packetId: code.trim() });
      const data = (await response.json()) as ApiEnvelope<{ amount?: number }>;
      if (response.ok && data.success !== false) {
        setResult({
          ok: true,
          message: `Claimed${data.data?.amount !== undefined ? ` ${data.data.amount}` : ""}.`,
        });
        setCode("");
        packets.reload();
      } else {
        setResult({
          ok: false,
          message: errorText(data.error) || "Could not claim this red packet.",
        });
      }
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : "Could not claim this red packet.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-tiger-black to-[#0d0d1a]">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-tiger-black/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-tiger-orange">
              <span className="text-xl font-bold text-white">T</span>
            </div>
            <span className="text-xl font-bold text-white">TigerEx</span>
          </Link>
          <button
            onClick={packets.reload}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <h1 className="mb-2 text-3xl font-bold text-white">Red Packets</h1>
        <p className="mb-6 text-gray-400">Share crypto with friends</p>

        <div className="mb-6 flex gap-2">
          <button
            onClick={() => setMode("receive")}
            className={`rounded-lg px-6 py-2 ${
              mode === "receive" ? "bg-tiger-orange text-white" : "bg-white/5 text-gray-300"
            }`}
          >
            Receive
          </button>
          <button
            onClick={() => setMode("create")}
            className={`rounded-lg px-6 py-2 ${
              mode === "create" ? "bg-tiger-orange text-white" : "bg-white/5 text-gray-300"
            }`}
          >
            Create
          </button>
        </div>

        {result && (
          <div
            className={`mb-4 flex items-start gap-2 rounded-lg px-4 py-3 text-sm ${
              result.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
            }`}
          >
            {result.ok && <CheckCircle className="h-5 w-5" />}
            <span>{result.message}</span>
          </div>
        )}

        {mode === "receive" ? (
          <div className="mx-auto max-w-lg rounded-xl border border-white/10 bg-white/5 p-6">
            <h3 className="mb-4 text-lg font-bold text-white">Open Red Packet</h3>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter red packet code"
              className="mb-4 w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 font-mono text-white"
            />
            <button
              onClick={claimPacket}
              disabled={busy || !code.trim()}
              className="w-full rounded-lg bg-tiger-orange py-3 font-bold text-white disabled:opacity-50"
            >
              {busy ? "Claiming…" : "Open"}
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-lg rounded-xl border border-white/10 bg-white/5 p-6">
            <h3 className="mb-4 text-lg font-bold text-white">Create Red Packet</h3>
            <div className="mb-4">
              <label className="mb-2 block text-sm text-gray-400">Type</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPacketType("average")}
                  className={`flex-1 rounded-lg py-2 ${
                    packetType === "average"
                      ? "bg-tiger-orange text-white"
                      : "border border-white/10 bg-white/5 text-white"
                  }`}
                >
                  Fixed
                </button>
                <button
                  onClick={() => setPacketType("random")}
                  className={`flex-1 rounded-lg py-2 ${
                    packetType === "random"
                      ? "bg-tiger-orange text-white"
                      : "border border-white/10 bg-white/5 text-white"
                  }`}
                >
                  Random
                </button>
              </div>
            </div>
            <div className="mb-4">
              <label className="mb-2 block text-sm text-gray-400">Asset</label>
              <select
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
              >
                <option value="USDT">USDT</option>
                <option value="USDC">USDC</option>
                <option value="TGR">TGR</option>
              </select>
            </div>
            <div className="mb-4">
              <label className="mb-2 block text-sm text-gray-400">Total Amount ({asset})</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 font-mono text-white"
              />
            </div>
            <div className="mb-4">
              <label className="mb-2 block text-sm text-gray-400">Number of Packets</label>
              <input
                type="number"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                placeholder="10"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 font-mono text-white"
              />
            </div>
            <div className="mb-4">
              <label className="mb-2 block text-sm text-gray-400">Message</label>
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
              />
            </div>
            <button
              onClick={createPacket}
              disabled={busy || !(Number(amount) > 0) || !(Number(count) > 0)}
              className="w-full rounded-lg bg-tiger-orange py-3 font-bold text-white disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create & Share"}
            </button>
          </div>
        )}

        <h3 className="mb-4 mt-8 text-lg font-bold text-white">Your Red Packets</h3>

        {packets.loading && <p className="text-sm text-gray-500">Loading red packets…</p>}
        {packets.error && (
          <p className="text-sm text-red-400">Could not load red packets: {packets.error}</p>
        )}
        {!packets.loading && !packets.error && list.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-gray-500">
            <Gift className="mx-auto mb-3 h-12 w-12 opacity-50" />
            <p>You have not created any red packets.</p>
          </div>
        )}

        <div className="space-y-3">
          {list.map((packet) => (
            <div key={packet.id} className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex justify-between">
                <div>
                  <div className="font-bold text-white">
                    {packet.type === "average" ? "Fixed" : "Random"}
                    {packet.message ? ` — ${packet.message}` : ""}
                  </div>
                  <div className="flex items-center gap-1 text-sm text-gray-400">
                    <Users className="h-3 w-3" />
                    {packet.claimed ?? 0}/{packet.quantity ?? 0} claimed
                  </div>
                  <div className="mt-1 font-mono text-xs text-gray-500">{packet.id}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-white">
                    {packet.amount ?? "—"} {packet.asset || ""}
                  </div>
                  <div
                    className={`text-sm ${
                      packet.status === "active" ? "text-green-400" : "text-gray-400"
                    }`}
                  >
                    {packet.status || "—"}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
