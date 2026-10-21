// Mirrors Orders.Contracts/OrderCreated.cs (serialized with System.Text.Json defaults: PascalCase)
export interface OrderCreated {
  OrderId: string;
  CustomerEmail: string;
  Total: number;
  CreatedAt: string;
}

export type Stage = 'client' | 'gateway' | 'api' | 'sns' | 'sqs' | 'processor' | 'dlq';

export type MessageState = 'visible' | 'in-flight' | 'deleted' | 'dlq';

export interface SqsMessage {
  messageId: string;
  order: OrderCreated;
  body: string;
  receiveCount: number;
  state: MessageState;
  /** Simulated time (ms) when the message becomes visible again */
  visibleAt: number;
  sentAt: number;
  poison: boolean;
  live: boolean;
}

/** A dot moving along an edge of the flow diagram */
export interface Token {
  id: number;
  label: string;
  from: Stage;
  to: Stage;
  startedAt: number;
  duration: number;
  kind: 'ok' | 'fail' | 'response';
}

export type LogSource = 'Client' | 'OrdersApi' | 'SNS' | 'SQS' | 'OrdersProcessor';

export interface LogEntry {
  id: number;
  time: number;
  source: LogSource;
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface InvocationRecord {
  messageId: string;
  orderId: string;
  receiveCount: number;
  ok: boolean;
}

export interface Invocation {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  records: InvocationRecord[];
  failures: string[];
}

export interface SimSettings {
  speed: number;
  batchSize: number;
  failureRate: number;
  visibilityTimeoutMs: number;
  maxReceiveCount: number;
}
