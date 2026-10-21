import { Component, inject } from '@angular/core';
import { FlowDiagram } from '../components/flow-diagram';
import { OrderForm } from '../components/order-form';
import { SimControls } from '../components/sim-controls';
import { QueuePanel } from '../components/queue-panel';
import { LambdaPanel } from '../components/lambda-panel';
import { LogStream } from '../components/log-stream';
import { ModeService } from '../mode.service';

@Component({
  selector: 'app-playground-page',
  imports: [FlowDiagram, OrderForm, SimControls, QueuePanel, LambdaPanel, LogStream],
  template: `
    <header class="hero">
      <span class="eyebrow"><span class="dot"></span>API Gateway · Lambda · SNS · SQS</span>
      <h1 class="display-xxl">How SQS and Lambda <br />process your orders</h1>
      <p class="body-lg mute lead">
        Orders.Api answers in milliseconds and hands the slow work to a queue. Orders.Processor drains it in batches,
        retries what fails, and parks what keeps failing in a dead-letter queue. Send an order and watch it travel.
      </p>
    </header>

    <section class="playground">
      <app-flow-diagram />

      <div class="row" [class.two]="!modes.live()">
        <app-order-form />
        @if (!modes.live()) {
          <app-sim-controls />
        }
      </div>

      <!-- These show simulated state only, so they hide when orders go to the real API -->
      @if (!modes.live()) {
        <div class="row two">
          <app-queue-panel />
          <app-lambda-panel />
        </div>

        <app-log-stream />
      }
    </section>
  `,
  styles: `
    .hero { padding-bottom: var(--space-huge); }
    .lead { max-width: 680px; margin-top: var(--space-xl); }
    .playground { display: flex; flex-direction: column; gap: var(--space-xl); }
    .row.two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-xl); }
    @media (max-width: 1279px) {
      .row.two { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 767px) {
      .hero { padding-bottom: var(--space-xxl); }
      .hero br { display: none; }
      .playground { gap: var(--space-lg); }
    }
  `,
})
export class PlaygroundPage {
  protected readonly modes = inject(ModeService);
}
