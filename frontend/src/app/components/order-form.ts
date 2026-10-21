import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { JsonPipe } from '@angular/common';
import { SimulationService } from '../simulation.service';
import { ApiService } from '../api.service';
import { Mode, ModeService } from '../mode.service';

interface LiveResult {
  status: number;
  location: string | null;
  body: unknown;
}

const SAMPLE_EMAILS = ['ada@example.com', 'linus@example.com', 'grace@example.com', 'alan@example.com', 'margaret@example.com'];

@Component({
  selector: 'app-order-form',
  imports: [FormsModule, JsonPipe],
  template: `
    <div class="card form-card">
      <div class="head">
        <h3 class="heading-md">Send an order</h3>
        <div class="segmented" role="tablist" aria-label="Mode">
          <button type="button" role="tab" [class.active]="mode() === 'simulated'" (click)="setMode('simulated')">Simulated</button>
          <button type="button" role="tab" [class.active]="mode() === 'live'" (click)="setMode('live')">Live API</button>
        </div>
      </div>

      <p class="caption mute intro">
        @if (mode() === 'simulated') {
          Runs entirely in your browser. Nothing is sent to AWS.
        } @else {
          Sends a real <code>POST /orders</code> to Orders.Api. Use the API Gateway emulator URL from the Aspire dashboard.
        }
      </p>

      <form (ngSubmit)="send()" class="fields">
        @if (mode() === 'live') {
          <label class="field">
            <span class="label">API base URL</span>
            <div class="url-row">
              <input class="text-input mono-input" name="baseUrl" [ngModel]="api.baseUrl()" (ngModelChange)="api.setBaseUrl($event)" placeholder="http://localhost:5050" />
              <button class="btn btn-outline" type="button" (click)="loadFromEnv()" title="Use ORDERS_API_BASE_URL from .env">Load from .env</button>
            </div>
          </label>
          @if (envMessage()) {
            <p class="caption mute">{{ envMessage() }}</p>
          }
        }
        <div class="row">
          <label class="field grow">
            <span class="label">Customer email</span>
            <input class="text-input" name="email" type="email" required [(ngModel)]="email" />
          </label>
          <label class="field total">
            <span class="label">Total</span>
            <input class="text-input" name="total" type="number" min="0" step="0.01" required [(ngModel)]="total" />
          </label>
        </div>

        <div class="actions">
          <button class="btn btn-primary" type="submit" [disabled]="sending()">
            {{ sending() ? 'Sending…' : 'Send order' }}
          </button>
          @if (mode() === 'simulated') {
            <button class="btn btn-outline" type="button" (click)="burst()">Send 10 orders</button>
            <button class="btn btn-outline" type="button" (click)="poison()" title="A message that always fails to process">Send poison message</button>
          }
        </div>
      </form>

      @if (mode() === 'live') {
        @if (liveError()) {
          <div class="result error caption">{{ liveError() }}</div>
        }
        @if (liveResult(); as r) {
          <div class="result">
            <div class="result-head caption">
              <span class="pill pill-green">{{ r.status }} Accepted</span>
              <span class="mute">Location: <code>{{ r.location ?? '—' }}</code></span>
            </div>
            <pre class="code-block">{{ r.body | json }}</pre>
            <p class="caption mute">
              The API returned before the order was processed. Orders.Processor picks it up from SQS:
              check its logs in the Aspire dashboard. The diagram above replays the trip with this order id.
            </p>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .form-card { display: flex; flex-direction: column; gap: var(--space-lg); height: 100%; }
    .head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); flex-wrap: wrap; }
    .intro code { font-size: 12px; }
    .fields { display: flex; flex-direction: column; gap: var(--space-md); }
    .row { display: flex; gap: var(--space-md); }
    .grow { flex: 1; }
    .total { width: 120px; flex: none; }
    .mono-input { font-family: var(--font-mono); font-size: 14px; }
    .url-row { display: flex; gap: var(--space-sm); }
    .url-row .text-input { flex: 1; min-width: 0; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-top: var(--space-xs); }
    .result { display: flex; flex-direction: column; gap: var(--space-sm); }
    .result-head { display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; }
    .result-head code { font-size: 12px; word-break: break-all; }
    .error { padding: var(--space-md); border-radius: var(--rounded-md); border: 1px solid rgba(255, 34, 1, 0.3); background: rgba(255, 34, 1, 0.05); color: #b31800; }
    @media (max-width: 480px) {
      .row { flex-direction: column; }
      .total { width: 100%; }
    }
  `,
})
export class OrderForm {
  private readonly sim = inject(SimulationService);
  protected readonly api = inject(ApiService);

  private readonly modes = inject(ModeService);
  protected readonly mode = this.modes.mode.asReadonly();
  protected readonly email = signal('ada@example.com');
  protected readonly total = signal(49.99);
  protected readonly sending = signal(false);
  protected readonly liveResult = signal<LiveResult | null>(null);
  protected readonly liveError = signal<string | null>(null);
  protected readonly envMessage = signal<string | null>(null);

  setMode(mode: Mode): void {
    if (mode === this.mode()) return;
    // Clear simulated traffic so the diagram only replays real orders in live mode
    if (mode === 'live') this.sim.reset();
    this.modes.mode.set(mode);
  }

  loadFromEnv(): void {
    this.api.loadBaseUrlFromEnv().subscribe({
      next: (url) =>
        this.envMessage.set(url ? `Loaded ${url} from .env` : 'ORDERS_API_BASE_URL is not set in .env or .env.local.'),
      error: () => this.envMessage.set('No env.json found. Start the app with npm start so .env gets read.'),
    });
  }

  send(): void {
    const customerEmail = this.email();
    const total = Number(this.total());
    if (this.mode() === 'simulated') {
      this.sim.submitOrder({ customerEmail, total });
      return;
    }

    this.sending.set(true);
    this.liveError.set(null);
    this.api.createOrder(customerEmail, total).subscribe({
      next: (res) => {
        this.sending.set(false);
        this.liveResult.set({ status: res.status, location: res.headers.get('Location'), body: res.body });
        this.sim.submitOrder({ customerEmail, total, liveOrderId: res.body?.orderId });
      },
      error: (err: HttpErrorResponse) => {
        this.sending.set(false);
        this.liveResult.set(null);
        this.liveError.set(
          err.status === 0
            ? `Could not reach ${this.api.baseUrl()}. Is the Aspire AppHost running, and does Orders.Api allow CORS from this origin?`
            : `${err.status} ${err.statusText}: ${typeof err.error === 'string' ? err.error : JSON.stringify(err.error)}`,
        );
      },
    });
  }

  burst(): void {
    for (let i = 0; i < 10; i++) {
      this.sim.submitOrder({
        customerEmail: SAMPLE_EMAILS[i % SAMPLE_EMAILS.length],
        total: Math.round((10 + Math.random() * 190) * 100) / 100,
        delayMs: i * 250,
      });
    }
  }

  poison(): void {
    this.sim.submitOrder({ customerEmail: 'broken@example.com', total: 0, poison: true });
  }
}
