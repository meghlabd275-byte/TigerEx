/**
 * TigerEx Alpha - Premium Market Access
 * 
 * Early access to promising tokens before public listing
 * Similar to Binance Alpha / Gate.io Alpha
 */

export class TigerExAlpha {
  private projects: Map<string, AlphaProject> = new Map();
  
  // List new promising tokens
  async listProject(project: AlphaProject): Promise<string> {
    const id = `ALPHA-${Date.now()}`;
    this.projects.set(id, { ...project, id, status: 'active', points: 0 });
    return id;
  }
  
  // Get eligible projects
  async getEligibleProjects(userId: string): Promise<AlphaProject[]> {
    return Array.from(this.projects.values()).filter(p => p.status === 'active');
  }
  
  // Earn points by trading
  async earnPoints(userId: string, projectId: string, volume: number): Promise<number> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error('Project not found');
    
    const points = volume / 100; // 1 point per $100 volume
    project.points += points;
    return points;
  }
  
  // Get user points
  async getUserPoints(userId: string): Promise<number> {
    return Array.from(this.projects.values())
      .reduce((sum, p) => sum + (p.userPoints?.get(userId) || 0), 0);
  }
  
  // Claim rewards
  async claimRewards(userId: string, projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error('Project not found');
    
    const points = project.userPoints?.get(userId) || 0;
    if (points < 100) throw new Error('Insufficient points');
    
    // Simplified reward distribution
    project.userPoints?.set(userId, 0);
  }
  
  // Get leaderboard
  async getLeaderboard(projectId: string): Promise<LeaderboardEntry[]> {
    const project = this.projects.get(projectId);
    if (!project) return [];
    
    return Array.from(project.userPoints?.entries() || [])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100)
      .map(([userId, points], i) => ({ rank: i + 1, userId, points }));
  }
}

export interface AlphaProject {
  id?: string;
  token: string;
  name: string;
  description: string;
  status: string;
  points: number;
  rewardPool: number;
  startDate: Date;
  endDate: Date;
  userPoints?: Map<string, number>;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  points: number;
}