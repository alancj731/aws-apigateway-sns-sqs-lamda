import { Injectable, computed, signal } from '@angular/core';
import {
  Invocation,
  LogEntry,
  LogSource,
  OrderCreated,
  SimSettings,
  SqsMessage,
  Stage,
  Token,
} from './models';

interface ScheduledEvent {
  at: number;
  run: () => void;
}

export interface SubmitOptions {
  customerEmail: string;
  total: number;
  poison?: boolean;
  /** Set when the order was really accepted by Orders.Api; the diagram replays it with the real id */
  liveOrderId?: string;
  /** Simulated delay before the client sends the request, used to stagger bursts */
  delayMs?: number;
}

/** Simulated time for a message to travel along one edge of the diagram */
export const HOP_MS = 600;
const RECORD_MS = 250;
const MAX_LOGS = 200;
const MAX_KEPT_MESSAGES = 60;

/**
 * An in-browser model of API Gateway → Orders.Api → SNS → SQS → Orders.Processor.
 * Everything runs on a simulated clock so the speed control and pause work everywhere.
 */
@Injectable({ providedIn: 'root' })
export class SimulationService {
  readonly now = signal(0);
  readonly paused = signal(false);
  readonly settings = signal<SimSettings>({
    speed: 1,
    batchSize: 5,
    failureRate: 0,
    visibilityTimeoutMs: 4000,
    maxReceiveCount: 3, // matches RedrivePolicy in orders.template.json
  });

  readonly messages = signal<SqsMessage[]>([]);
  readonly tokens = signal<Token[]>([]);
  readonly logs = signal<LogEntry[]>([]);
  readonly invocations = signal<Invocation[]>([]);
  readonly currentInvocation = signal<Invocation | null>(null);
  readonly processedCount = signal(0);
  readonly ordersSent = signal(0);

  readonly visible = computed(() => this.messages().filter((m) => m.state === 'visible'));
  readonly inFlight = computed(() => this.messages().filter((m) => m.state === 'in-flight'));
  readonly deadLettered = computed(() => this.messages().filter((m) => m.state === 'dlq'));
  readonly failedRecords = computed(() =>
    this.invocations().reduce((sum, inv) => sum + inv.failures.length, 0),
  );

  /** Stages that currently have a message touching them, for highlighting nodes */
  readonly activeStages = computed(() => {
    const active = new Set<Stage>();
    for (const t of this.tokens()) {
      active.add(t.from);
      active.add(t.to);
    }
    if (this.currentInvocation()) active.add('processor');
    if (this.visible().length || this.inFlight().length) active.add('sqs');
    if (this.deadLettered().length) active.add('dlq');
    return active;
  });

  private events: ScheduledEvent[] = [];
  private nextId = 1;
  private nextInvocationId = 1;
  private lastFrame: number | null = null;

  constructor() {
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame((t) => this.frame(t));
    }
  }

  submitOrder(opts: SubmitOptions): void {
    if (opts.delayMs) {
      this.schedule(this.now() + opts.delayMs, () => this.submitOrder({ ...opts, delayMs: 0 }));
      return;
    }
    const t = this.now();
    const live = !!opts.liveOrderId;
    this.ordersSent.update((n) => n + 1);
    this.log('Client', 'info', `POST /orders { "customerEmail": "${opts.customerEmail}", "total": ${opts.total} }`);
    this.addToken('client', 'gateway', 'POST', 'ok');

    this.schedule(t + HOP_MS, () => {
      this.log('OrdersApi', 'info', 'API Gateway (HTTP API) invoked the Orders.Api Lambda');
      this.addToken('gateway', 'api', 'event', 'ok');
    });

    this.schedule(t + 2 * HOP_MS, () => {
      const order: OrderCreated = {
        OrderId: opts.liveOrderId ?? crypto.randomUUID(),
        CustomerEmail: opts.customerEmail,
        Total: opts.total,
        CreatedAt: new Date().toISOString(),
      };
      this.log('OrdersApi', 'info', `sns.PublishAsync(OrdersTopic, OrderCreated ${short(order.OrderId)})`);
      this.log('OrdersApi', 'info', `202 Accepted → /orders/${order.OrderId}`);
      this.addToken('api', 'sns', 'OrderCreated', 'ok');
      this.addToken('api', 'client', '202', 'response', 2 * HOP_MS);

      this.schedule(this.now() + HOP_MS, () => {
        this.log('SNS', 'info', `Fan-out ${short(order.OrderId)} → OrdersQueue (raw message delivery)`);
        this.addToken('sns', 'sqs', 'message', 'ok');
      });

      this.schedule(this.now() + 2 * HOP_MS, () => {
        const message: SqsMessage = {
          messageId: crypto.randomUUID(),
          order,
          body: JSON.stringify(order),
          receiveCount: 0,
          state: 'visible',
          visibleAt: this.now(),
          sentAt: this.now(),
          poison: !!opts.poison,
          live,
        };
        this.messages.update((list) => [...list, message].slice(-MAX_KEPT_MESSAGES));
        this.log('SQS', 'info', `Enqueued message ${short(message.messageId)} (order ${short(order.OrderId)})`);
      });
    });
  }

  updateSettings(patch: Partial<SimSettings>): void {
    this.settings.update((s) => ({ ...s, ...patch }));
  }

  togglePause(): void {
    this.paused.update((p) => !p);
  }

  clearLogs(): void {
    this.logs.set([]);
  }

  /** Like SQS PurgeQueue: drops visible and in-flight messages from OrdersQueue */
  purgeQueue(): void {
    const count = this.visible().length + this.inFlight().length;
    this.messages.update((list) => list.filter((m) => m.state !== 'visible' && m.state !== 'in-flight'));
    this.log('SQS', 'warn', `PurgeQueue(OrdersQueue): ${count} message${count === 1 ? '' : 's'} removed`);
  }

  purgeDeadLetterQueue(): void {
    const count = this.deadLettered().length;
    this.messages.update((list) => list.filter((m) => m.state !== 'dlq'));
    this.log('SQS', 'warn', `PurgeQueue(OrdersDeadLetterQueue): ${count} message${count === 1 ? '' : 's'} removed`);
  }

  /** Resets the processor stats and batch history; a batch that is still running finishes normally */
  clearInvocations(): void {
    this.invocations.set([]);
    this.processedCount.set(0);
  }

  reset(): void {
    this.events = [];
    this.messages.set([]);
    this.tokens.set([]);
    this.logs.set([]);
    this.invocations.set([]);
    this.currentInvocation.set(null);
    this.processedCount.set(0);
    this.ordersSent.set(0);
    this.nextInvocationId = 1;
  }

  private frame(timestamp: number): void {
    const delta = this.lastFrame === null ? 0 : Math.min(timestamp - this.lastFrame, 100);
    this.lastFrame = timestamp;
    if (!this.paused() && delta > 0) {
      this.now.update((n) => n + delta * this.settings().speed);
      this.step();
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private step(): void {
    const now = this.now();

    const due = this.events.filter((e) => e.at <= now).sort((a, b) => a.at - b.at);
    if (due.length) {
      this.events = this.events.filter((e) => e.at > now);
      due.forEach((e) => e.run());
    }

    this.tokens.update((list) => {
      const remaining = list.filter((t) => now < t.startedAt + t.duration);
      return remaining.length === list.length ? list : remaining;
    });

    this.expireVisibilityTimeouts(now);
    this.redriveToDeadLetterQueue();
    this.pollQueue(now);
  }

  /** In-flight messages that were not deleted become visible again once the visibility timeout ends */
  private expireVisibilityTimeouts(now: number): void {
    const expired = this.messages().filter((m) => m.state === 'in-flight' && m.visibleAt <= now);
    if (!expired.length) return;
    for (const m of expired) {
      this.log('SQS', 'warn', `Visibility timeout expired: ${short(m.messageId)} is visible again (receiveCount ${m.receiveCount})`);
    }
    this.patchMessages(expired, { state: 'visible' });
  }

  /** RedrivePolicy: a message received maxReceiveCount times without being deleted moves to the DLQ */
  private redriveToDeadLetterQueue(): void {
    const max = this.settings().maxReceiveCount;
    const exhausted = this.visible().filter((m) => m.receiveCount >= max);
    if (!exhausted.length) return;
    for (const m of exhausted) {
      this.log('SQS', 'error', `${short(m.messageId)} exceeded maxReceiveCount (${max}) → OrdersDeadLetterQueue`);
      this.addToken('sqs', 'dlq', 'DLQ', 'fail');
    }
    this.patchMessages(exhausted, { state: 'dlq' });
  }

  /** The Lambda event source mapping polls SQS and invokes the processor with a batch */
  private pollQueue(now: number): void {
    if (this.currentInvocation()) return;
    const { batchSize, visibilityTimeoutMs, failureRate } = this.settings();
    const batch = this.visible().slice(0, batchSize);
    if (!batch.length) return;

    const received = batch.map((m) => ({
      ...m,
      state: 'in-flight' as const,
      receiveCount: m.receiveCount + 1,
      visibleAt: now + visibilityTimeoutMs,
    }));
    this.replaceMessages(received);

    const invocation: Invocation = {
      id: this.nextInvocationId++,
      startedAt: now,
      finishedAt: null,
      records: [],
      failures: [],
    };
    this.currentInvocation.set(invocation);
    this.log('SQS', 'info', `ReceiveMessage → batch of ${received.length} for OrdersProcessor`);
    this.addToken('sqs', 'processor', `${received.length}×`, 'ok');

    const start = now + HOP_MS;
    this.schedule(start, () => {
      this.log('OrdersProcessor', 'info', `FunctionHandler(SQSEvent with ${received.length} record${received.length > 1 ? 's' : ''})`);
    });

    received.forEach((m, i) => {
      this.schedule(start + (i + 1) * RECORD_MS, () => {
        // Live orders replay what normally happens to a real order, so the simulated failure rate doesn't apply
        const ok = !m.poison && (m.live || Math.random() >= failureRate);
        if (ok) {
          this.log('OrdersProcessor', 'info', `Processing order ${m.order.OrderId} for ${m.order.CustomerEmail}, total ${m.order.Total}`);
        } else {
          const reason = m.poison ? 'Empty message' : 'Downstream service unavailable';
          this.log('OrdersProcessor', 'error', `Failed to process message ${m.messageId}: ${reason}`);
        }
        this.currentInvocation.update((inv) =>
          inv && {
            ...inv,
            records: [...inv.records, { messageId: m.messageId, orderId: m.order.OrderId, receiveCount: m.receiveCount, ok }],
            failures: ok ? inv.failures : [...inv.failures, m.messageId],
          },
        );
      });
    });

    this.schedule(start + (received.length + 1) * RECORD_MS, () => {
      const inv = this.currentInvocation();
      if (!inv) return;
      const finished = { ...inv, finishedAt: this.now() };
      const succeeded = inv.records.filter((r) => r.ok).map((r) => r.messageId);

      this.log('OrdersProcessor', inv.failures.length ? 'warn' : 'info',
        `Returned SQSBatchResponse with ${inv.failures.length} BatchItemFailure${inv.failures.length === 1 ? '' : 's'}`);
      if (succeeded.length) {
        this.log('SQS', 'info', `DeleteMessageBatch: ${succeeded.length} message${succeeded.length > 1 ? 's' : ''} removed`);
        this.patchMessages(this.messages().filter((m) => succeeded.includes(m.messageId)), { state: 'deleted' });
        this.processedCount.update((n) => n + succeeded.length);
      }
      if (inv.failures.length) {
        this.addToken('processor', 'sqs', `${inv.failures.length} retry`, 'fail');
      }

      this.invocations.update((list) => [finished, ...list].slice(0, 20));
      this.currentInvocation.set(null);
    });
  }

  private patchMessages(targets: SqsMessage[], patch: Partial<SqsMessage>): void {
    const ids = new Set(targets.map((m) => m.messageId));
    this.messages.update((list) => list.map((m) => (ids.has(m.messageId) ? { ...m, ...patch } : m)));
  }

  private replaceMessages(updated: SqsMessage[]): void {
    const byId = new Map(updated.map((m) => [m.messageId, m]));
    this.messages.update((list) => list.map((m) => byId.get(m.messageId) ?? m));
  }

  private schedule(at: number, run: () => void): void {
    this.events.push({ at, run });
  }

  private addToken(from: Stage, to: Stage, label: string, kind: Token['kind'], duration = HOP_MS): void {
    this.tokens.update((list) => [
      ...list,
      { id: this.nextId++, from, to, label, kind, startedAt: this.now(), duration },
    ]);
  }

  private log(source: LogSource, level: LogEntry['level'], text: string): void {
    this.logs.update((list) => [...list, { id: this.nextId++, time: this.now(), source, level, text }].slice(-MAX_LOGS));
  }
}

export function short(id: string): string {
  return id.slice(0, 8);
}
