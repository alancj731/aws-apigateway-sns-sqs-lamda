import { Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { SimulationService, short } from '../simulation.service';

@Component({
  selector: 'app-queue-panel',
  imports: [DecimalPipe],
  template: `
    <section class="pane">
      <header class="pane-header">
        <span class="pane-title"><span class="dot"></span>SQS · OrdersQueue</span>
        <span class="pane-meta">
          <span class="mono">{{ sim.visible().length }} visible · {{ sim.inFlight().length }} in flight</span>
          <button class="btn btn-link pane-action" type="button" (click)="sim.purgeQueue()" [disabled]="!queue().length">Clear</button>
        </span>
      </header>
      <div class="pane-body list">
        @for (m of queue(); track m.messageId) {
          <div class="msg" [class.inflight]="m.state === 'in-flight'">
            <div class="msg-main">
              <code class="id">{{ short(m.messageId) }}</code>
              <span class="who">{{ m.order.CustomerEmail }}</span>
              <span class="amount mono">\${{ m.order.Total | number: '1.2-2' }}</span>
            </div>
            <div class="msg-meta">
              @if (m.live) { <span class="pill pill-green">live</span> }
              @if (m.poison) { <span class="pill pill-fail">poison</span> }
              <span class="pill" [class.pill-warn]="m.receiveCount > 1" [class.pill-dark]="m.receiveCount <= 1">
                receives {{ m.receiveCount }}/{{ sim.settings().maxReceiveCount }}
              </span>
              @if (m.state === 'in-flight') {
                <span class="pill pill-dark">hidden {{ remaining(m.visibleAt) }}s</span>
              } @else {
                <span class="pill pill-dark">visible</span>
              }
            </div>
          </div>
        } @empty {
          <p class="empty">Queue is empty. Send an order to enqueue a message.</p>
        }
      </div>

      <header class="pane-header dlq-header">
        <span class="pane-title"><span class="dot dlq-dot"></span>SQS · OrdersDeadLetterQueue</span>
        <span class="pane-meta">
          <span class="mono">{{ sim.deadLettered().length }}</span>
          <button class="btn btn-link pane-action" type="button" (click)="sim.purgeDeadLetterQueue()" [disabled]="!sim.deadLettered().length">Clear</button>
        </span>
      </header>
      <div class="pane-body list dlq">
        @for (m of sim.deadLettered(); track m.messageId) {
          <div class="msg">
            <div class="msg-main">
              <code class="id">{{ short(m.messageId) }}</code>
              <span class="who">{{ m.order.CustomerEmail }}</span>
            </div>
            <div class="msg-meta"><span class="pill pill-fail">gave up after {{ m.receiveCount }} receives</span></div>
          </div>
        } @empty {
          <p class="empty">No dead letters. Try a poison message or raise the failure rate.</p>
        }
      </div>
    </section>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .pane { height: 100%; }
    .list { display: flex; flex-direction: column; gap: var(--space-sm); max-height: 300px; overflow-y: auto; }
    .dlq { max-height: 160px; }
    .dlq-header { border-top: 1px solid #2e2e2e; }
    .dlq-dot { background: var(--accent-tomato); }
    .msg { display: flex; flex-direction: column; gap: 6px; padding: var(--space-sm) var(--space-md); border: 1px solid #2e2e2e; border-radius: var(--rounded-md); background: var(--canvas-night-soft); }
    .msg.inflight { opacity: 0.6; border-style: dashed; }
    .msg-main { display: flex; gap: var(--space-md); align-items: baseline; font-size: 13px; min-width: 0; }
    .id { color: var(--primary); font-size: 12px; }
    .who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--on-dark); }
    .amount { font-size: 12px; color: var(--ink-faint); }
    .msg-meta { display: flex; gap: 6px; flex-wrap: wrap; }
    .empty { font-size: 13px; color: var(--ink-mute-2); padding: var(--space-sm) 0; }
  `,
})
export class QueuePanel {
  protected readonly sim = inject(SimulationService);
  protected readonly short = short;

  protected readonly queue = computed(() =>
    this.sim.messages().filter((m) => m.state === 'visible' || m.state === 'in-flight'),
  );

  protected remaining(visibleAt: number): string {
    return Math.max(0, (visibleAt - this.sim.now()) / 1000).toFixed(1);
  }
}
