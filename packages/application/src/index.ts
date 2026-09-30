import type {
  Monitor,
  Shop,
  TestRun,
  RunStep,
  Artifact,
  StoredArtifact,
  RunAnalysis,
  AiAnalysisRecord,
  Incident,
  IncidentOccurrence,
} from '@ghostshopper/domain';
export * from './run-processing.js';
export * from './artifacts.js';
export * from './analysis.js';
import {
  createMonitorSchema,
  createTestRunSchema,
  entityIdSchema,
  listTestRunsSchema,
  listIncidentsSchema,
  type ListIncidentsInput,
  paginationSchema,
  updateMonitorSchema,
  validate,
  type CreateMonitorInput,
  type UpdateMonitorInput,
  type Pagination,
  type ListTestRunsInput,
} from '@ghostshopper/contracts';

// Implementations are bound to one server-authenticated tenant. No operation accepts shopId.
export interface TenantRepositories {
  readonly aiAnalyses: { list(runId: string): Promise<AiAnalysisRecord[]> };
  readonly incidents: {
    list(input: ListIncidentsInput): Promise<Incident[]>;
    get(id: string): Promise<Incident | null>;
    occurrences(id: string, input: Pagination): Promise<IncidentOccurrence[]>;
  };
  readonly analyses: { list(runId: string): Promise<RunAnalysis[]> };
  readonly artifacts: {
    list(runId: string): Promise<Artifact[]>;
    get(id: string): Promise<StoredArtifact | null>;
  };
  readonly shops: { get(): Promise<Shop> };
  readonly monitors: {
    create(input: CreateMonitorInput): Promise<Monitor>;
    get(id: string): Promise<Monitor | null>;
    list(input: Pagination): Promise<Monitor[]>;
    update(id: string, input: UpdateMonitorInput): Promise<Monitor>;
  };
  readonly runs: {
    create(monitorId: string): Promise<TestRun>;
    get(id: string): Promise<TestRun | null>;
    list(input: ListTestRunsInput): Promise<TestRun[]>;
    steps(id: string): Promise<RunStep[]>;
  };
}
export class MonitoringService {
  constructor(private readonly repositories: TenantRepositories) {}
  listAiAnalyses(runId: unknown) {
    return this.repositories.aiAnalyses.list(validate(entityIdSchema, runId));
  }
  listIncidents(input: unknown = {}) {
    return this.repositories.incidents.list(validate(listIncidentsSchema, input));
  }
  getIncident(id: unknown) {
    return this.repositories.incidents.get(validate(entityIdSchema, id));
  }
  listIncidentOccurrences(id: unknown, input: unknown = {}) {
    return this.repositories.incidents.occurrences(
      validate(entityIdSchema, id),
      validate(paginationSchema, input),
    );
  }
  listRunAnalyses(runId: unknown) {
    return this.repositories.analyses.list(validate(entityIdSchema, runId));
  }
  listArtifacts(runId: unknown) {
    return this.repositories.artifacts.list(validate(entityIdSchema, runId));
  }
  getArtifact(id: unknown) {
    return this.repositories.artifacts.get(validate(entityIdSchema, id));
  }
  getShop() {
    return this.repositories.shops.get();
  }
  createMonitor(input: unknown) {
    return this.repositories.monitors.create(validate(createMonitorSchema, input));
  }
  getMonitor(id: unknown) {
    return this.repositories.monitors.get(validate(entityIdSchema, id));
  }
  listMonitors(input: unknown = {}) {
    return this.repositories.monitors.list(validate(paginationSchema, input));
  }
  updateMonitor(id: unknown, input: unknown) {
    return this.repositories.monitors.update(
      validate(entityIdSchema, id),
      validate(updateMonitorSchema, input),
    );
  }
  createTestRun(input: unknown) {
    return this.repositories.runs.create(validate(createTestRunSchema, input).monitorId);
  }
  getTestRun(id: unknown) {
    return this.repositories.runs.get(validate(entityIdSchema, id));
  }
  listTestRuns(input: unknown = {}) {
    return this.repositories.runs.list(validate(listTestRunsSchema, input));
  }
  listRunSteps(id: unknown) {
    return this.repositories.runs.steps(validate(entityIdSchema, id));
  }
}
export * from './ai.js';
