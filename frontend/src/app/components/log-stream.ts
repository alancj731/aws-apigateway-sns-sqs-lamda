import { Component, ElementRef, afterRenderEffect, inject, viewChild } from '@angular/core';
import { SimulationService } from '../simulation.service';

@Component({
  selector: 'app-log-stream',
  template: `
    <section class="pane">
      <header class="pane-header">
        <span class="pane-title">Log stream</span>
        <span class="pane-meta">
          <span class="mono">{{ sim.logs().length }} lines</span>
          <button class="btn btn-link pane-action" type="button" (click)="sim.clearLogs()" [disabled]="!sim.logs().length">Clear</button>
        </span>
      </header>
      <div class="pane-body log" #scroller>
        @for (l of sim.logs(); track l.id) {
          <div class="line" [class]="'line ' + l.level">
            <span class="time">{{ (l.time / 1000).toFixed(2).padStart(7, ' ') }}s</span>
            <span class="src" [attr.data-src]="l.source">{{ l.source }}</span>
            <span class="text">{{ l.text }}</span>
          </div>
        } @empty {
          <div class="empty">Logs from every component appear here, like CloudWatch Logs.</div>
        }
      </div>
    </section>
  `,
  styles: `
    .log { height: 320px; overflow-y: auto; font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6; }
    .line { display: grid; grid-template-columns: 72px 130px 1fr; gap: var(--space-md); }
    .time { color: var(--ink-mute); white-space: pre; }
    .src { color: var(--ink-faint); }
    .src[data-src='OrdersProcessor'], .src[data-src='OrdersApi'] { color: var(--primary); }
    .text { color: #e6e6e6; word-break: break-word; }
    .line.warn .text { color: var(--accent-yellow); }
    .line.error .text { color: #ff8a75; }
    .empty { color: var(--ink-mute-2); }    @media (max-width: 767px) {
      .line { grid-template-columns: 1fr; gap: 0; padding-bottom: var(--space-xs); }
      .time { display: none; }
    }
  `,
})
export class LogStream {
  protected readonly sim = inject(SimulationService);
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  constructor() {
    afterRenderEffect(() => {
      this.sim.logs();
      const el = this.scroller().nativeElement;
      el.scrollTop = el.scrollHeight;
    });
  }
}
