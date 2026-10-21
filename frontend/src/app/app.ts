import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/** How long the sidebar stays open after the pointer or focus leaves it */
const SIDEBAR_HIDE_MS = 3000;
/** Matches the phone breakpoint in app.scss, where the sidebar is a top bar that always shows */
const WIDE_QUERY = '(min-width: 768px)';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
  host: { '[class.sidebar-hidden]': 'sidebarHidden()' },
})
export class App {
  private readonly open = signal(true);
  private readonly wide = signal(true);
  protected readonly sidebarHidden = computed(() => this.wide() && !this.open());
  private readonly menuToggle = viewChild.required<ElementRef<HTMLButtonElement>>('menuToggle');
  private readonly injector = inject(Injector);
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const destroyRef = inject(DestroyRef);
    if (typeof matchMedia !== 'undefined') {
      const query = matchMedia(WIDE_QUERY);
      const sync = () => this.wide.set(query.matches);
      sync();
      query.addEventListener('change', sync);
      destroyRef.onDestroy(() => query.removeEventListener('change', sync));
    }
    this.scheduleHide();
    destroyRef.onDestroy(() => clearTimeout(this.hideTimer));
  }

  /** Opens the sidebar from the left-edge hover strip or the menu button */
  protected showSidebar(): void {
    this.open.set(true);
    this.scheduleHide();
  }

  /** Hides the sidebar right away from its "Hide menu" button */
  protected hideSidebar(): void {
    clearTimeout(this.hideTimer);
    this.open.set(false);
    // The sidebar becomes inert, so move focus to the button that brings it back
    afterNextRender(() => this.menuToggle().nativeElement.focus(), { injector: this.injector });
  }

  /** Keeps the sidebar open while the pointer or keyboard focus is inside it */
  protected keepSidebar(): void {
    clearTimeout(this.hideTimer);
    this.open.set(true);
  }

  protected scheduleHide(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.open.set(false), SIDEBAR_HIDE_MS);
  }
}
