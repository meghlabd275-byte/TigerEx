/**
 * TigerEx Red Packet / Promo
 * Red packets like Binance, lucky draws
 */

export interface RedPacket {
  id: string;
  symbol: string;
  amount: number;
  totalCount: number;
  type: string;
  remaining: number;
  creator: string;
  status: string;
  claimLink: string;
  created: number;
}

export interface RedPacketClaim {
  userId: string;
  amount: number;
  claimedAt: number;
}

export class RedPacketPromo {
  private packets: Map<string, RedPacket> = new Map();
  private claims: Map<string, RedPacketClaim[]> = new Map();

  // Create red packet
  async createRedPacket(
    userId: string,
    symbol: string,
    amount: number,
    totalCount: number,
    type: string = 'LUCKY'
  ): Promise<{ success: boolean; packetId: string; shareLink: string }> {
    const packetId = `rp_${Date.now()}`;
    const packet: RedPacket = {
      id: packetId,
      symbol,
      amount,
      totalCount,
      type,
      remaining: totalCount,
      creator: userId,
      status: 'active',
      claimLink: `tigerex.com/rp/${packetId}`,
      created: Date.now(),
    };
    this.packets.set(packetId, packet);
    return { success: true, packetId, shareLink: `tigerex.com/rp/${packetId}` };
  }

  // Claim red packet
  async claimRedPacket(packetId: string, userId: string): Promise<{ success: boolean; amount: number; message: string }> {
    const packet = this.packets.get(packetId);
    if (!packet) {
      return { success: false, amount: 0, message: 'Invalid packet' };
    }
    if (packet.remaining <= 0) {
      return { success: false, amount: 0, message: 'Already claimed' };
    }

    const claimAmount = packet.amount / packet.totalCount;
    packet.remaining--;
    this.packets.set(packetId, packet);

    const claim: RedPacketClaim = { userId, amount: claimAmount, claimedAt: Date.now() };
    const existing = this.claims.get(packetId) || [];
    existing.push(claim);
    this.claims.set(packetId, existing);

    return { success: true, amount: claimAmount, message: 'Lucky!' };
  }

  // Get my red packets
  async getMyPackets(userId: string): Promise<RedPacket[]> {
    return Array.from(this.packets.values()).filter(p => p.creator === userId);
  }

  // Get red packet details
  async getPacketDetails(packetId: string): Promise<RedPacket | null> {
    return this.packets.get(packetId) || null;
  }

  // Get claim records
  async getClaimRecords(packetId: string): Promise<RedPacketClaim[]> {
    return this.claims.get(packetId) || [];
  }

  // Lucky draw / Lucky spin
  async luckyDraw(userId: string): Promise<{ success: boolean; prize: string; amount: number }> {
    const prizes = [
      { prize: '10 USDT', amount: 10 },
      { prize: '5 USDT', amount: 5 },
      { prize: '1 USDT', amount: 1 },
      { prize: '0.1 BTC', amount: 5 },
      { prize: 'Better luck next time!', amount: 0 },
    ];
    const result = prizes[Math.floor(Math.random() * prizes.length)];
    return { success: true, prize: result.prize, amount: result.amount };
  }

  // Daily check-in bonus
  async dailyCheckIn(userId: string): Promise<{ success: boolean; bonus: number; streak: number }> {
    return { success: true, bonus: 1, streak: 1 };
  }
}

export default RedPacketPromo;