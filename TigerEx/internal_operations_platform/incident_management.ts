/**
 * Incident Management System
 * 
 * Structured incident response with automatic escalation.
 */

export enum IncidentSeverity {
  SEV1_CRITICAL = 'sev1_critical',   // Complete outage
  SEV2_HIGH = 'sev2_high',           // Major feature down
  SEV3_MEDIUM = 'sev3_medium',      // Partial degradation
  SEV4_LOW = 'sev4_low'             // Minor issue
}

export enum IncidentStatus {
  DETECTED = 'detected',
  INVESTIGATING = 'investigating',
  IDENTIFIED = 'identified',
  MITIGATING = 'mitigating',
  RESOLVED = 'resolved',
  POST_MORTEM = 'post_mortem'
}

export class IncidentManager {
  private incidents: Incident[] = [];
  private autoEscalateTimers = {
    [IncidentSeverity.SEV1_CRITICAL]: 5 * 60 * 1000,      // 5 mins
    [IncidentSeverity.SEV2_HIGH]: 15 * 60 * 1000,     // 15 mins
    [IncidentSeverity.SEV3_MEDIUM]: 60 * 60 * 1000,     // 1 hour
    [IncidentSeverity.SEV4_LOW]: 4 * 60 * 60 * 1000      // 4 hours
  };

  async createIncident(input: IncidentInput): Promise<Incident> {
    const incident: Incident = {
      id: `INC-${Date.now()}`,
      title: input.title,
      description: input.description,
      severity: input.severity,
      status: IncidentStatus.DETECTED,
      affectedSystems: input.affectedSystems,
      detectedAt: new Date(),
      timeline: [{
        action: 'detected',
        timestamp: new Date(),
        actor: 'system',
        details: { description: input.description }
      }]
    };

    this.incidents.push(incident);
    return incident;
  }

  async escalateToOnCall(incidentId: string): Promise<void> {
    const incident = this.incidents.find(i => i.id === incidentId);
    if (!incident) throw new Error('Incident not found');

    incident.status = IncidentStatus.INVESTIGATING;
    incident.timeline.push({
      action: 'escalated_to_on_call',
      timestamp: new Date(),
      actor: 'system'
    });

    // Here we'd integrate with PagerDuty/airtable/etc.
  }

  async updateStatus(
    incidentId: string,
    status: IncidentStatus,
    updatedBy: string,
    notes?: string
  ): Promise<void> {
    const incident = this.incidents.find(i => i.id === incidentId);
    if (!incident) throw new Error('Incident not found');

    incident.status = status;
    incident.timeline.push({
      action: `status_change_${status}`,
      timestamp: new Date(),
      actor: updatedBy,
      details: { notes }
    });
  }

  async addUpdate(
    incidentId: string,
    updatedBy: string,
    update: string
  ): Promise<void> {
    const incident = this.incidents.find(i => i.id === incidentId);
    if (!incident) throw new Error('Incident not found');

    incident.timeline.push({
      action: 'update',
      timestamp: new Date(),
      actor: updatedBy,
      details: { update }
    });
  }

  async resolve(incidentId: string, resolvedBy: string, rootCause: string): Promise<void> {
    const incident = this.incidents.find(i => i.id === incidentId);
    if (!incident) throw new Error('Incident not found');

    incident.status = IncidentStatus.RESOLVED;
    incident.rootCause = rootCause;
    incident.resolvedBy = resolvedBy;
    incident.resolvedAt = new Date();

    incident.timeline.push({
      action: 'resolved',
      timestamp: new Date(),
      actor: resolvedBy,
      details: { rootCause }
    });
  }

  async getOpenCount(): Promise<number> {
    return this.incidents.filter(i => 
      i.status !== IncidentStatus.RESOLVED
    ).length;
  }

  async getActiveIncidents(): Promise<Incident[]> {
    return this.incidents.filter(i => 
      i.status !== IncidentStatus.RESOLVED &&
      i.status !== IncidentStatus.POST_MORTEM
    );
  }
}

interface IncidentInput {
  title: string;
  description: string;
  severity: IncidentSeverity;
  affectedSystems: string[];
}

interface Incident {
  id: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  affectedSystems: string[];
  rootCause?: string;
  resolvedBy?: string;
  detectedAt: Date;
  resolvedAt?: Date;
  timeline: Array<{
    action: string;
    timestamp: Date;
    actor: string;
    details?: Record<string, unknown>;
  }>;
}

export { IncidentSeverity, IncidentStatus };