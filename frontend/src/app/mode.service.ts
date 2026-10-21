import { Injectable, computed, signal } from '@angular/core';

export type Mode = 'simulated' | 'live';

/** Whether orders go to the in-browser simulation or the real Orders.Api; panels that only make sense for the simulation hide in live mode */
@Injectable({ providedIn: 'root' })
export class ModeService {
  readonly mode = signal<Mode>('simulated');
  readonly live = computed(() => this.mode() === 'live');
}
