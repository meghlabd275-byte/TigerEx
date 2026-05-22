/**
 * TigerEx Governance DAO
 * 
 * Decentralized governance like MakerDAO, Compound Governor
 * Features: Proposals, voting, delegation, treasury, timelock
 */

import { EventEmitter } from 'events';
import { Logger } from '../common/logger';

export enum ProposalState {
  PENDING = 'pending',
  ACTIVE = 'active',
  CANCELLED = 'cancelled',
  DEFEATED = 'defeated',
  SUCCEEDED = 'succeeded',
  QUEUED = 'queued',
  EXECUTED = 'executed',
  EXPIRED = 'expired'
}

export enum VoteType {
  FOR = 'for',
  AGAINST = 'against',
  ABSTAIN = 'abstain'
}

export interface Proposal {
  id: string;
  title: string;
  description: string;
  proposer: string;
  targets: string[];
  values: string[];
  signatures: string[];
  calldatas: string[];
  state: ProposalState;
  for_votes: number;
  against_votes: number;
  abstain_votes: number;
  start_block: number;
  end_block: number;
  execution_time?: Date;
  created_at: Date;
}

export interface Vote {
  id: string;
  proposal_id: string;
  voter: string;
  vote_type: VoteType;
  weight: number;
  reason?: string;
  timestamp: Date;
}

export interface Delegate {
  id: string;
  delegator: string;
  delegate: string;
  votes: number;
  delegated_at: Date;
}

export class GovernanceDAO {
  private logger: Logger;
  private proposals: Map<string, Proposal> = new Map();
  private votes: Map<string, Vote[]> = new Map();
  private delegates: Map<string, Delegate> = new Map();
  private treasury: Map<string, number> = new Map();
  private eventEmitter: EventEmitter;
  
  private readonly QUORUM = 4000000;
  private readonly PROPOSAL_THRESHOLD = 100000;
  private readonly VOTING_PERIOD = 17280;
  private readonly TIMELOCK_PERIOD = 17280;
  
  constructor() {
    this.logger = new Logger('GovernanceDAO');
    this.eventEmitter = new EventEmitter();
    this.treasury.set('USDT', 10000000);
    this.treasury.set('USDC', 5000000);
    this.treasury.set('ETH', 1000);
  }

  async createProposal(params: { proposer: string; title: string; description: string; targets: string[]; values: string[]; signatures: string[]; calldatas: string[] }): Promise<Proposal> {
    const proposal: Proposal = {
      id: `prop_${Date.now()}`,
      title: params.title,
      description: params.description,
      proposer: params.proposer,
      targets: params.targets,
      values: params.values,
      signatures: params.signatures,
      calldatas: params.calldatas,
      state: ProposalState.PENDING,
      for_votes: 0,
      against_votes: 0,
      abstain_votes: 0,
      start_block: 0,
      end_block: 0,
      created_at: new Date()
    };
    this.proposals.set(proposal.id, proposal);
    this.eventEmitter.emit('proposal_created', proposal);
    return proposal;
  }

  async activateProposal(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.state !== ProposalState.PENDING) throw new Error('Not pending');
    proposal.state = ProposalState.ACTIVE;
    proposal.start_block = Date.now();
    proposal.end_block = Date.now() + this.VOTING_PERIOD;
    this.proposals.set(proposalId, proposal);
  }

  async castVote(params: { proposal_id: string; voter: string; vote_type: VoteType; weight: number; reason?: string }): Promise<Vote> {
    const proposal = this.proposals.get(params.proposal_id);
    if (!proposal || proposal.state !== ProposalState.ACTIVE) throw new Error('Not active');
    
    const vote: Vote = {
      id: `vote_${Date.now()}`,
      proposal_id: params.proposal_id,
      voter: params.voter,
      vote_type: params.vote_type,
      weight: params.weight,
      reason: params.reason,
      timestamp: new Date()
    };
    
    const pv = this.votes.get(params.proposal_id) || [];
    pv.push(vote);
    this.votes.set(params.proposal_id, pv);
    
    if (params.vote_type === VoteType.FOR) proposal.for_votes += params.weight;
    else if (params.vote_type === VoteType.AGAINST) proposal.against_votes += params.weight;
    else proposal.abstain_votes += params.weight;
    this.proposals.set(params.proposal_id, proposal);
    return vote;
  }

  async queueProposal(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error('Not found');
    proposal.state = ProposalState.QUEUED;
    proposal.execution_time = new Date(Date.now() + this.TIMELOCK_PERIOD * 1000);
    this.proposals.set(proposalId, proposal);
  }

  async executeProposal(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error('Not found');
    proposal.state = ProposalState.EXECUTED;
    this.proposals.set(proposalId, proposal);
  }

  async delegate(delegatee: string, delegator: string): Promise<Delegate> {
    const existing = Array.from(this.delegates.values()).find(d => d.delegator === delegator);
    if (existing) { existing.delegate = delegatee; return existing; }
    const d: Delegate = { id: `del_${Date.now()}`, delegator, delegate: delegatee, votes: 0, delegated_at: new Date() };
    this.delegates.set(d.id, d);
    return d;
  }

  async getTreasuryBalance(token: string): Promise<number> { return this.treasury.get(token) || 0; }

  async treasuryTransfer(params: { token: string; to: string; amount: number; proposal_id?: string }): Promise<void> {
    const bal = this.treasury.get(params.token) || 0;
    if (bal < params.amount) throw new Error('Insufficient');
    this.treasury.set(params.token, bal - params.amount);
  }

  async getProposal(id: string): Promise<Proposal | null> { return this.proposals.get(id) || null; }
  async getProposals(state?: ProposalState): Promise<Proposal[]> {
    let r = Array.from(this.proposals.values());
    if (state) r = r.filter(p => p.state === state);
    return r;
  }
  async getVotes(proposalId: string): Promise<Vote[]> { return this.votes.get(proposalId) || []; }
}

export default GovernanceDAO;