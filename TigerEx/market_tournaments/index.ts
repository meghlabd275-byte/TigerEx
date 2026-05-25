/**
 * TIGEREX TRADING TOURNAMENTS PLATFORM
 * Production competitions, leaderboards, prizes
 */

export interface Tournament {
  id: string;
  name: string;
  description: string;
  startTime: number;
  endTime: number;
  prizePool: number;
  pairs: string[];
  status: 'upcoming' | 'active' | 'completed';
  participants: number;
  minTrades: number;
  createdAt: number;
}

export interface Participant {
  tournamentId: string;
  userId: string;
  username: string;
  volume: number;
  trades: number;
  pnl: number;
  rank: number;
  prize?: number;
}

export class TournamentsPlatform {
  private tournaments = new Map();
  private participants = new Map();
  private counter = 0;

  async createTournament(params: { 
    name: string; description?: string; startTime: number; endTime: number; 
    prizePool: number; pairs: string[]; minTrades?: number 
  }): Promise<Tournament> {
    const t: Tournament = {
      id: `TOURNEY_${++this.counter}`,
      name: params.name,
      description: params.description || '',
      startTime: params.startTime,
      endTime: params.endTime,
      prizePool: params.prizePool,
      pairs: params.pairs,
      status: 'upcoming',
      participants: 0,
      minTrades: params.minTrades || 10,
      createdAt: Date.now()
    };
    this.tournaments.set(t.id, t);
    return t;
  }

  async join(tournamentId: string, userId: string, username: string): Promise<{ joined: boolean; position: number }> {
    const t = this.tournaments.get(tournamentId);
    if (!t) return { joined: false, position: 0 };
    
    const key = `${tournamentId}_${userId}`;
    if (!this.participants.has(key)) {
      this.participants.set(key, { tournamentId, userId, username, volume: 0, trades: 0, pnl: 0, rank: 0 });
      t.participants++;
    }
    return { joined: true, position: t.participants };
  }

  async updateProgress(tournamentId: string, userId: string, volume: number, pnl: number): Promise<void> {
    const key = `${tournamentId}_${userId}`;
    const p = this.participants.get(key);
    if (p) { p.volume += volume; p.trades++; p.pnl += pnl; }
  }

  async getLeaderboard(tournamentId: string, limit: number = 10): Promise<Participant[]> {
    const all = Array.from(this.participants.values())
      .filter(p => p.tournamentId === tournamentId)
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, limit);
    return all.map((p, i) => ({ ...p, rank: i + 1 }));
  }

  async distributePrizes(tournamentId: string): Promise<{ distributed: boolean; prizes: Record<string, number> }> {
    const t = this.tournaments.get(tournamentId);
    if (!t) return { distributed: false, prizes: {} };
    
    const leaderboard = await this.getLeaderboard(tournamentId, 10);
    const prizes: Record<string, number> = {};
    const distribution = [0.4, 0.25, 0.15, 0.1, 0.1]; // Top 5
    
    leaderboard.forEach((p, i) => {
      if (i < distribution.length) {
        prizes[p.userId] = t.prizePool * distribution[i];
        p.prize = prizes[p.userId];
      }
    });
    
    t.status = 'completed';
    return { distributed: true, prizes };
  }

  getTournaments(status?: string): Tournament[] {
    let all = Array.from(this.tournaments.values());
    if (status) all = all.filter(t => t.status === status);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }
}

export default TournamentsPlatform;