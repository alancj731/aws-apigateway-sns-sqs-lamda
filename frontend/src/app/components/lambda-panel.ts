import { Component, computed, inject } from '@angular/core';
import { SimulationService, short } from '../simulation.service';

@Component({
  selector: 'app-lambda-panel',
  template: `
    <section class="pane">
      <header class="pane-header">
        <span class="pane-title"><span class="dot" [class.idle]="!sim.currentInvocation()"></span>λ Orders.Processor</span>
        <span class="pane-meta">
          <span class="mono">{{ sim.currentInvocation() ? 'running' : 'idle' }}</span>
          <button class="btn btn-link pane-action" type="button" (click)="sim.clearInvocations()" [disabled]="!sim.invocations().length && !sim.processedCount()">Clear</button>
        </span>
      </header>
      <div class="pane-body body">
        <div class="stats">
          <div><span class="stat">{{ sim.invocations().length + (sim.currentInvocation() ? 1 : 0) }}</span><span class="micro">invocations</span></div>
          <div><span class="stat">{{ sim.processedCount() }}</span><span class="micro">processed</span></div>
          <div><span class="stat fail">{{ sim.failedRecords() }}</span><span class="micro">failed records</span></div>
        </div>

        @if (shown(); as inv) {
          <div class="batch-head micro">
            <span>Batch #{{ inv.id }}</span>
            <span>{{ inv.records.length }} record{{ inv.records.length === 1 ? '' : 's' }} handled{{ inv.finishedAt === null ? '…' : '' }}</span>
          </div>
          <div class="records">
            @for (r of inv.records; track r.messageId) {
              <div class="record">
                <code>{{ short(r.messageId) }}</code>
                <span class="micro order">order {{ short(r.orderId) }} · receive #{{ r.receiveCount }}</span>
                <span class="pill" [class.pill-green]="r.ok" [class.pill-fail]="!r.ok">{{ r.ok ? 'ok' : 'failed' }}</span>
              </div>
            }
          </div>
          <div class="micro label">return new SQSBatchResponse(failures);</div>
          <pre class="code-block response">{{ responseJson() }}</pre>
        } @else {
          <p class="empty">Waiting for the event source mapping to deliver a batch.</p>
        }
      </div>
    </section>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .pane { height: 100%; }
    .body { display: flex; flex-direction: column; gap: var(--space-md); }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-sm); }
    .stats > div { display: flex; flex-direction: column; padding: var(--space-sm) var(--space-md); border: 1px solid #2e2e2e; border-radius: var(--rounded-md); background: var(--canvas-night-soft); color: var(--ink-faint); }
    .stat { font-size: 22px; font-weight: 500; color: var(--on-dark); }
    .stat.fail { color: #ff8a75; }
    .batch-head { display: flex; justify-content: space-between; color: var(--ink-faint); }
    .records { display: flex; flex-direction: column; gap: 6px; max-height: 190px; overflow-y: auto; }
    .record { display: flex; align-items: center; gap: var(--space-md); font-size: 13px; }
    .record code { color: var(--primary); font-size: 12px; }
    .order { flex: 1; color: var(--ink-faint); }
    .label { color: var(--ink-mute-2); font-family: var(--font-mono); }
    .response { background: #141414; border: 1px solid #2e2e2e; font-size: 12px; max-height: 150px; overflow: auto; }
    .dot.idle { background: var(--ink-mute); }
    .empty { font-size: 13px; color: var(--ink-mute-2); }
  `,
})
export class LambdaPanel {
  protected readonly sim = inject(SimulationService);
  protected readonly short = short;

  protected readonly shown = computed(() => this.sim.currentInvocation() ?? this.sim.invocations()[0] ?? null);

  protected readonly responseJson = computed(() => {
    const inv = this.shown();
    if (!inv) return '';
    const body = { batchItemFailures: inv.failures.map((id) => ({ itemIdentifier: id })) };
    return JSON.stringify(body, null, 2);
  });
}
