import { Component, inject } from '@angular/core';
import { SimulationService } from '../simulation.service';

const SPEEDS = [0.5, 1, 2, 4];

@Component({
  selector: 'app-sim-controls',
  template: `
    <div class="card controls">
      <div class="head">
        <h3 class="heading-md">Tune the pipeline</h3>
        <div class="buttons">
          <button class="btn btn-outline" type="button" (click)="sim.togglePause()">{{ sim.paused() ? 'Resume' : 'Pause' }}</button>
          <button class="btn btn-outline" type="button" (click)="sim.reset()">Reset</button>
        </div>
      </div>

      <div class="field">
        <span class="label">Speed</span>
        <div class="segmented">
          @for (s of speeds; track s) {
            <button type="button" [class.active]="sim.settings().speed === s" (click)="sim.updateSettings({ speed: s })">{{ s }}×</button>
          }
        </div>
      </div>

      <label class="field">
        <span class="label-row"><span class="label">Batch size</span><code>{{ sim.settings().batchSize }}</code></span>
        <input type="range" min="1" max="10" step="1" [value]="sim.settings().batchSize"
               (input)="sim.updateSettings({ batchSize: +$any($event.target).value })" />
        <span class="micro mute">Max records the event source mapping hands to one Lambda invocation.</span>
      </label>

      <label class="field">
        <span class="label-row"><span class="label">Failure rate</span><code>{{ (sim.settings().failureRate * 100).toFixed(0) }}%</code></span>
        <input type="range" min="0" max="1" step="0.05" [value]="sim.settings().failureRate"
               (input)="sim.updateSettings({ failureRate: +$any($event.target).value })" />
        <span class="micro mute">Chance the processor throws for a record, e.g. a downstream outage.</span>
      </label>

      <label class="field">
        <span class="label-row"><span class="label">Visibility timeout</span><code>{{ (sim.settings().visibilityTimeoutMs / 1000).toFixed(1) }}s</code></span>
        <input type="range" min="2000" max="10000" step="500" [value]="sim.settings().visibilityTimeoutMs"
               (input)="sim.updateSettings({ visibilityTimeoutMs: +$any($event.target).value })" />
        <span class="micro mute">How long a received message stays hidden before SQS redelivers it.</span>
      </label>

      <div class="redrive caption">
        <span class="mute">Redrive policy</span>
        <code>maxReceiveCount: {{ sim.settings().maxReceiveCount }}</code>
      </div>
    </div>
  `,
  styles: `
    .controls { display: flex; flex-direction: column; gap: var(--space-xl); height: 100%; }
    .head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); flex-wrap: wrap; }
    .buttons { display: flex; gap: var(--space-sm); }
    .label-row { display: flex; justify-content: space-between; align-items: baseline; }
    .label-row code { font-size: 13px; }
    .redrive { display: flex; justify-content: space-between; padding-top: var(--space-lg); border-top: 1px solid var(--hairline-cool); }
    .redrive code { font-size: 13px; }
  `,
})
export class SimControls {
  protected readonly sim = inject(SimulationService);
  protected readonly speeds = SPEEDS;
}
