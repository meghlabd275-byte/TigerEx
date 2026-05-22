/**
 * TigerEx Phone Support Platform
 * 
 * Multi-channel customer support like Twilio, Zendesk
 * Features: IVR, call routing, ticket management, callbacks, WhatsApp
 */

import { EventEmitter } from 'events';
import { Logger } from '../common/logger';

export enum CallStatus {
  RINGING = 'ringing',
  CONNECTED = 'connected',
  ON_HOLD = 'on_hold',
  TRANSFERRED = 'transferred',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export enum TicketPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent'
}

export enum TicketStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  WAITING = 'waiting',
  RESOLVED = 'resolved',
  CLOSED = 'closed'
}

export interface Call {
  id: string;
  caller_id: string;
  callee: string;
  direction: 'inbound' | 'outbound';
  status: CallStatus;
  duration: number;
  recording_url?: string;
  ivr_options: string[];
  transferred_to?: string;
  created_at: Date;
}

export interface Ticket {
  id: string;
  user_id: string;
  subject: string;
  description: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_agent?: string;
  messages: TicketMessage[];
  created_at: Date;
  updated_at: Date;
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  sender: 'user' | 'agent' | 'system';
  content: string;
  attachments?: string[];
  timestamp: Date;
}

export interface IVRMenu {
  id: string;
  name: string;
  options: IVROption[];
}

export interface IVROption {
  digit: string;
  prompt: string;
  action: string;
  transfer_to?: string;
}

export class PhoneSupportPlatform {
  private logger: Logger;
  private calls: Map<string, Call> = new Map();
  private tickets: Map<string, Ticket> = new Map();
  private agents: Map<string, any> = new Map();
  private eventEmitter: EventEmitter;
  
  private readonly IVR_MENU: IVRMenu = {
    id: 'main',
    name: 'Main Menu',
    options: [
      { digit: '1', prompt: 'Sales', action: 'sales' },
      { digit: '2', prompt: 'Support', action: 'support' },
      { digit: '3', prompt: 'Trading', action: 'trading' },
      { digit: '4', prompt: 'Account', action: 'account' },
      { digit: '0', prompt: 'Agent', action: 'agent' }
    ]
  };
  
  constructor() {
    this.logger = new Logger('PhoneSupport');
    this.eventEmitter = new EventEmitter();
  }

  // ========== INBOUND CALLS ==========

  async handleInboundCall(params: {
    caller_id: string;
    phone_number: string;
  }): Promise<Call> {
    const call: Call = {
      id: `call_${Date.now()}`,
      caller_id: params.caller_id,
      callee: params.phone_number,
      direction: 'inbound',
      status: CallStatus.RINGING,
      duration: 0,
      ivr_options: this.IVR_MENU.options.map(o => `${o.digit}. ${o.prompt}`),
      created_at: new Date()
    };

    this.calls.set(call.id, call);
    this.eventEmitter.emit('call_received', call);
    this.logger.info(`Inbound call: ${call.id} from ${params.caller_id}`);
    return call;
  }

  async processIVRSelection(callId: string, digit: string): Promise<{
    action: string;
    prompt: string;
    transfer_to?: string;
  }> {
    const call = this.calls.get(callId);
    if (!call) throw new Error('Call not found');

    const option = this.IVR_MENU.options.find(o => o.digit === digit);
    if (!option) throw new Error('Invalid option');

    call.status = CallStatus.CONNECTED;
    this.calls.set(callId, call);

    this.eventEmitter.emit('ivr_selected', { callId, option });
    return { action: option.action, prompt: option.prompt, transfer_to: option.transfer_to };
  }

  async transferCall(callId: string, toAgent: string): Promise<void> {
    const call = this.calls.get(callId);
    if (!call) throw new Error('Call not found');

    call.status = CallStatus.TRANSFERRED;
    call.transferred_to = toAgent;
    this.calls.set(callId, call);
    this.eventEmitter.emit('call_transferred', { callId, to: toAgent });
  }

  async endCall(callId: string, duration: number): Promise<void> {
    const call = this.calls.get(callId);
    if (!call) throw new Error('Call not found');

    call.status = CallStatus.COMPLETED;
    call.duration = duration;
    this.calls.set(callId, call);
    this.eventEmitter.emit('call_ended', call);
  }

  // ========== OUTBOUND CALLS ==========

  async initiateOutboundCall(params: {
    agent_id: string;
    phone_number: string;
    purpose: string;
  }): Promise<Call> {
    const call: Call = {
      id: `call_${Date.now()}`,
      caller_id: params.agent_id,
      callee: params.phone_number,
      direction: 'outbound',
      status: CallStatus.RINGING,
      duration: 0,
      ivr_options: [],
      created_at: new Date()
    };

    this.calls.set(call.id, call);
    this.eventEmitter.emit('outbound_call_initiated', call);
    return call;
  }

  async scheduleCallback(params: {
    user_id: string;
    phone_number: string;
    scheduled_time: Date;
    reason: string;
  }): Promise<{ callback_id: string }> {
    const callbackId = `cb_${Date.now()}`;
    this.eventEmitter.emit('callback_scheduled', params);
    return { callback_id: callbackId };
  }

  // ========== TICKET MANAGEMENT ==========

  async createTicket(params: {
    user_id: string;
    subject: string;
    description: string;
    category: string;
    priority?: TicketPriority;
  }): Promise<Ticket> {
    const ticket: Ticket = {
      id: `ticket_${Date.now()}`,
      user_id: params.user_id,
      subject: params.subject,
      description: params.description,
      category: params.category,
      priority: params.priority || TicketPriority.MEDIUM,
      status: TicketStatus.OPEN,
      messages: [],
      created_at: new Date(),
      updated_at: new Date()
    };

    this.tickets.set(ticket.id, ticket);
    this.eventEmitter.emit('ticket_created', ticket);
    this.logger.info(`Ticket created: ${ticket.id}`);
    return ticket;
  }

  async addMessage(params: {
    ticket_id: string;
    sender: 'user' | 'agent' | 'system';
    content: string;
    attachments?: string[];
  }): Promise<TicketMessage> {
    const ticket = this.tickets.get(params.ticket_id);
    if (!ticket) throw new Error('Ticket not found');

    const message: TicketMessage = {
      id: `msg_${Date.now()}`,
      ticket_id: params.ticket_id,
      sender: params.sender,
      content: params.content,
      attachments: params.attachments,
      timestamp: new Date()
    };

    ticket.messages.push(message);
    ticket.updated_at = new Date();
    this.tickets.set(params.ticket_id, ticket);

    this.eventEmitter.emit('message_added', message);
    return message;
  }

  async assignTicket(params: {
    ticket_id: string;
    agent_id: string;
  }): Promise<void> {
    const ticket = this.tickets.get(params.ticket_id);
    if (!ticket) throw new Error('Ticket not found');

    ticket.assigned_agent = params.agent_id;
    ticket.status = TicketStatus.IN_PROGRESS;
    ticket.updated_at = new Date();
    this.tickets.set(params.ticket_id, ticket);
    this.eventEmitter.emit('ticket_assigned', { ticketId: params.ticket_id, agentId: params.agent_id });
  }

  async resolveTicket(ticketId: string, resolution: string): Promise<void> {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) throw new Error('Ticket not found');

    ticket.status = TicketStatus.RESOLVED;
    ticket.updated_at = new Date();
    this.tickets.set(ticketId, ticket);

    await this.addMessage({
      ticket_id: ticketId,
      sender: 'system',
      content: `Ticket resolved: ${resolution}`
    });
  }

  async closeTicket(ticketId: string): Promise<void> {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) throw new Error('Ticket not found');

    ticket.status = TicketStatus.CLOSED;
    ticket.updated_at = new Date();
    this.tickets.set(ticketId, ticket);
  }

  // ========== AGENTS ==========

  async registerAgent(params: {
    agent_id: string;
    name: string;
    email: string;
    skills: string[];
    max_calls: number;
  }): Promise<void> {
    this.agents.set(params.agent_id, {
      ...params,
      status: 'available',
      current_calls: 0
    });
  }

  async getAvailableAgents(skill?: string): Promise<any[]> {
    return Array.from(this.agents.values())
      .filter(a => a.status === 'available' && (!skill || a.skills.includes(skill)))
      .filter(a => a.current_calls < a.max_calls);
  }

  // ========== WHATSAPP & MESSAGING ==========

  async sendWhatsApp(params: {
    to: string;
    message: string;
  }): Promise<{ message_id: string }> {
    return { message_id: `wa_${Date.now()}` };
  }

  async handleWhatsAppWebhook(params: any): Promise<void> {
    this.eventEmitter.emit('whatsapp_received', params);
  }

  // ========== ANALYTICS ==========

  async getSupportStats(): Promise<{
    total_calls: number;
    avg_duration: number;
    tickets_open: number;
    tickets_resolved: number;
    avg_response_time: number;
  }> {
    const calls = Array.from(this.calls.values());
    const tickets = Array.from(this.tickets.values());

    return {
      total_calls: calls.length,
      avg_duration: calls.reduce((s, c) => s + c.duration, 0) / (calls.length || 1),
      tickets_open: tickets.filter(t => t.status === TicketStatus.OPEN).length,
      tickets_resolved: tickets.filter(t => t.status === TicketStatus.RESOLVED).length,
      avg_response_time: 300 // seconds
    };
  }

  // ========== QUERIES ==========

  async getCall(callId: string): Promise<Call | null> { return this.calls.get(callId) || null; }
  async getTickets(userId?: string, status?: TicketStatus): Promise<Ticket[]> {
    let r = Array.from(this.tickets.values());
    if (userId) r = r.filter(t => t.user_id === userId);
    if (status) r = r.filter(t => t.status === status);
    return r;
  }
  async getTicket(ticketId: string): Promise<Ticket | null> { return this.tickets.get(ticketId) || null; }
}

export default PhoneSupportPlatform;