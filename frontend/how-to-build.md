# How to build: Orders pipeline visualizer (Angular frontend for `orders-serverless`)

A browser app that shows how an order travels through the backend in `../orders-serverless`:

```
client ─► API Gateway ─► Orders.Api (Lambda) ──publish──► SNS topic ──► SQS queue ──trigger──► Orders.Processor (Lambda)
                                                                            │
                                                                            └─ after 3 failed receives ─► dead-letter queue
```

It has two modes:

- **Simulated**: the whole pipeline runs as a model in your browser. Nothing is sent to AWS. You can slow it down,
  pause it, make the processor fail and watch messages retry and land in the dead-letter queue.
- **Live API**: sends a real `POST /orders` to Orders.Api (the Aspire emulator, or the API deployed in Step 6 of
  the backend guide), shows the real response, and replays the order's trip on the diagram.

And two pages, picked from a sidebar that hides itself after 3 seconds:

- **Playground**: the diagram, the order form, the tuning controls and the simulated queue, processor and logs.
- **How it works**: the four hops, each with the backend code that does it.

Work through the steps in order. Each one ends with a **Check it** so you know it worked before moving on.
Small files are shown in full. For the larger ones (the simulation and the panels) the guide shows the parts that
matter and names the file in `src/app` that has the rest.

---

## Step 1: Install the tools and create the app

### 1a. Tools

You need **Node.js 22** or later (`node --version`). Step 7 uses `util.parseEnv`, which older versions don't have.

```bash
npm install -g @angular/cli@22      # `ng` command; optional, `npx ng` works too
```

### 1b. Create the project

```bash
cd /home/jian/code/personal/dotnetaws/lamda-sqs
npx @angular/cli@22 new orders-visualizer --directory frontend --style scss --ssr false
cd frontend
```

| Option | Why |
|---|---|
| `--directory frontend` | Puts the app next to `orders-serverless`, while the project keeps the name `orders-visualizer` |
| `--style scss` | Component and global styles in SCSS (nesting, `&:hover`) |
| `--ssr false` | A plain single-page app: it's static files, so any web host or S3 bucket can serve it |

Angular 22 creates a **standalone, zoneless** app: no `NgModule`, and no `zone.js`. The UI updates when a
**signal** changes, which is how every piece of state in this app is stored.

### 1c. Fonts and formatting

In `src/index.html`, set the title and load the Inter font inside `<head>`:

```html
<title>Orders Pipeline: SQS + Lambda</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap" rel="stylesheet">
```

`.prettierrc` uses single quotes and a 100-character line, with the Angular parser for `.html` files.

**Check it:** `npm start` → open http://localhost:4200 → the Angular welcome page.

---

## Step 2: Design tokens and shared styles

`DESIGN.md` describes the look: white canvas, near-black ink, one emerald-green accent, Inter type. `src/styles.scss`
turns it into CSS variables (tokens) and a few shared classes that every component uses.

```scss
/* Design tokens from DESIGN.md (Supabaze design language) */
:root {
  --primary: #3ecf8e;
  --ink: #171717;
  --ink-mute: #707070;
  --canvas: #ffffff;
  --canvas-soft: #fafafa;
  --canvas-night: #1c1c1c;
  --hairline: #dfdfdf;
  --font-sans: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  --space-sm: 8px;
  --space-lg: 16px;
  --rounded-md: 8px;
  --container: 1280px;
  /* …the full list is in src/styles.scss */
}
```

The shared classes, grouped:

| Classes | Used for |
|---|---|
| `.display-xxl` … `.heading-md`, `.body-lg`, `.caption`, `.micro`, `.mute` | Type scale, shrinking on tablets and phones |
| `.btn`, `.btn-primary`, `.btn-outline`, `.btn-link` | Buttons |
| `.card` | White panels (order form, tuning controls) |
| `.pane`, `.pane-header`, `.pane-title`, `.pane-meta`, `.pane-action`, `.pane-body` | Dark "console" panels (queue, processor, logs) |
| `.pill`, `.pill-green`, `.pill-fail`, `.pill-warn` | Small status labels |
| `.field`, `.label`, `.text-input`, `.segmented` | Form controls |

Components only use tokens (`var(--primary)`), never raw colours, so the whole look changes in one file.

**Check it:** `npm run build` → `Application bundle generation complete`.

---

## Step 3: Model the backend's data: `src/app/models.ts`

```typescript
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
```

Things to notice:
- `OrderCreated` uses **PascalCase** on purpose. `System.Text.Json` keeps C# property names when the API
  serializes the event to SNS, so this is exactly what sits in the SQS message body.
- `MessageState` follows a real SQS message: **visible** (waiting), **in-flight** (received, hidden until the
  visibility timeout ends), **deleted** (processed), **dlq** (gave up).

**Check it:** `npm run build` → no errors.

---

## Step 4: The simulation engine: `src/app/simulation.service.ts`

This service is a small model of API Gateway → Orders.Api → SNS → SQS → Orders.Processor. Every panel reads
from it. The full file is about 330 lines; these are the ideas it's built on.

### 4a. State is signals

```typescript
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
  readonly logs = signal<LogEntry[]>([]);
  readonly invocations = signal<Invocation[]>([]);
  readonly currentInvocation = signal<Invocation | null>(null);

  readonly visible = computed(() => this.messages().filter((m) => m.state === 'visible'));
  readonly inFlight = computed(() => this.messages().filter((m) => m.state === 'in-flight'));
  readonly deadLettered = computed(() => this.messages().filter((m) => m.state === 'dlq'));
  // …
}
```

`providedIn: 'root'` makes it a single shared instance, so the simulation keeps running when you switch pages.
`computed` signals (`visible`, `inFlight`…) recalculate only when `messages` changes.

### 4b. A simulated clock

```typescript
private frame(timestamp: number): void {
  const delta = this.lastFrame === null ? 0 : Math.min(timestamp - this.lastFrame, 100);
  this.lastFrame = timestamp;
  if (!this.paused() && delta > 0) {
    this.now.update((n) => n + delta * this.settings().speed);
    this.step();
  }
  requestAnimationFrame((t) => this.frame(t));
}
```

Time doesn't come from `Date.now()`. Each animation frame moves `now` forward by the real time that passed,
multiplied by **speed**, and not at all while **paused**. Everything else is scheduled against `now`
(`this.schedule(at, run)`), so the speed buttons and Pause affect the whole pipeline at once.

### 4c. Each tick follows the SQS rules

```typescript
private step(): void {
  // 1. run scheduled events that are due (a hop finished, a record was processed…)
  // 2. drop diagram dots that reached the end of their edge
  this.expireVisibilityTimeouts(now);  // in-flight past visibleAt → visible again
  this.redriveToDeadLetterQueue();     // visible with receiveCount >= maxReceiveCount → dlq
  this.pollQueue(now);                 // processor idle and messages visible → invoke with a batch
}
```

`pollQueue` is the Lambda **event source mapping**: it takes up to `batchSize` visible messages, marks them
in-flight, bumps `receiveCount`, and invokes the processor. Each record then succeeds or fails:

```typescript
// Live orders replay what normally happens to a real order, so the simulated failure rate doesn't apply
const ok = !m.poison && (m.live || Math.random() >= failureRate);
```

At the end of the batch it returns an `SQSBatchResponse`, like `Orders.Processor/Functions.cs` does: successful
messages are deleted, failed ones stay in-flight until the visibility timeout ends and SQS redelivers them.
After 3 receives, the redrive policy moves them to the dead-letter queue.

### 4d. Public methods the UI calls

| Method | What it does |
|---|---|
| `submitOrder({ customerEmail, total, poison?, liveOrderId?, delayMs? })` | Sends an order through every hop, with logs and diagram dots |
| `updateSettings(patch)`, `togglePause()`, `reset()` | Tuning controls |
| `clearLogs()` | Empties the log stream only |
| `purgeQueue()`, `purgeDeadLetterQueue()` | Like SQS `PurgeQueue`; logs a `PurgeQueue(...)` line |
| `clearInvocations()` | Resets the processor stats; a running batch still finishes |

**Check it:** `npm run build` → no errors. (Nothing shows yet; the panels come next.)

---

## Step 5: The panels: `src/app/components/`

Each panel is a standalone component with an inline template that reads signals from `SimulationService`.

| File | Shows |
|---|---|
| `flow-diagram.ts` | SVG of the seven stages, moving dots for messages, counts on SQS/Processor/DLQ |
| `order-form.ts` | Simulated / Live API switch, email and total, **Send order**, **Send 10 orders**, **Send poison message** |
| `sim-controls.ts` | **Tune the pipeline**: Pause, Reset, speed, batch size, failure rate, visibility timeout |
| `queue-panel.ts` | OrdersQueue and OrdersDeadLetterQueue messages, each with a **Clear** button |
| `lambda-panel.ts` | λ Orders.Processor stats, the last batch and its `SQSBatchResponse`, with a **Clear** button |
| `log-stream.ts` | CloudWatch-style log lines with a **Clear** button |
| `explainer.ts` | The four "How it works" cards with code taken from `orders-serverless/src` |

A small panel shows the pattern. `log-stream.ts` (template trimmed):

```typescript
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
          <div class="line" [class]="'line ' + l.level">…</div>
        } @empty {
          <div class="empty">Logs from every component appear here, like CloudWatch Logs.</div>
        }
      </div>
    </section>
  `,
})
export class LogStream {
  protected readonly sim = inject(SimulationService);
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  constructor() {
    // Keep the newest line in view
    afterRenderEffect(() => {
      this.sim.logs();
      const el = this.scroller().nativeElement;
      el.scrollTop = el.scrollHeight;
    });
  }
}
```

- `@for … track` and `@empty` are Angular's built-in control flow; no `*ngFor` import needed.
- Reading `sim.logs()` in the template is enough for Angular to re-render when logs change.

**Check it** (after Step 8 wires the page together): send an order in Simulated mode → a green dot travels the
diagram, the queue panel shows the message, the processor runs a batch, and the log stream fills in.

---

## Step 6: Live API mode

### 6a. Let the API accept calls from the browser

A browser blocks a page on `localhost:4200` from reading a response from another origin unless the API allows
it (**CORS**). In `orders-serverless/src/Orders.Api/Program.cs`, before `builder.Build()`:

```csharp
// Lets the Angular visualizer in /frontend (ng serve on port 4200) call the API from the browser
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins("http://localhost:4200").AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("Location")));
```

and after it, `app.UseCors();`. `WithExposedHeaders("Location")` lets the page read the `Location` header of the
202 response. Redeploy the API (`dotnet lambda deploy-function`, or push to `dev` for the GitHub workflow) if you
use the one in AWS.

### 6b. Call the API: `src/app/api.service.ts`

```typescript
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

const STORAGE_KEY = 'orders-api-base-url';

interface EnvConfig {
  ordersApiBaseUrl?: string;
}

export interface CreateOrderResponse {
  orderId: string;
}

/** Talks to the real Orders.Api (through the Aspire API Gateway emulator or a deployed HTTP API) */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  readonly baseUrl = signal(readStoredUrl());

  setBaseUrl(url: string): void {
    this.baseUrl.set(url);
    try {
      localStorage.setItem(STORAGE_KEY, url);
    } catch {
      // storage unavailable (private mode); the value just won't persist
    }
  }

  /** Reads ORDERS_API_BASE_URL, copied from .env into env.json by scripts/write-env.mjs */
  loadBaseUrlFromEnv(): Observable<string | null> {
    return this.http.get<EnvConfig>('env.json').pipe(
      map((env) => env.ordersApiBaseUrl ?? null),
      tap((url) => url && this.setBaseUrl(url)),
    );
  }

  createOrder(customerEmail: string, total: number): Observable<HttpResponse<CreateOrderResponse>> {
    const url = `${this.baseUrl().replace(/\/+$/, '')}/orders`;
    return this.http
      .post<CreateOrderResponse>(url, { customerEmail, total }, { observe: 'response' })
      .pipe(tap({ error: (err) => console.error('POST /orders failed', err) }));
  }
}

function readStoredUrl(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'http://localhost:5050';
  } catch {
    return 'http://localhost:5050';
  }
}
```

`HttpClient` needs `provideHttpClient(withFetch())` in `src/app/app.config.ts` (shown in Step 8).
`observe: 'response'` returns the whole response, so the form can show the status code and `Location` header.

### 6c. Share the mode: `src/app/mode.service.ts`

```typescript
import { Injectable, computed, signal } from '@angular/core';

export type Mode = 'simulated' | 'live';

/** Whether orders go to the in-browser simulation or the real Orders.Api; panels that only make sense for the simulation hide in live mode */
@Injectable({ providedIn: 'root' })
export class ModeService {
  readonly mode = signal<Mode>('simulated');
  readonly live = computed(() => this.mode() === 'live');
}
```

The order form sets it; the Playground page and the diagram read it.

### 6d. Send a live order (`order-form.ts`)

```typescript
setMode(mode: Mode): void {
  if (mode === this.mode()) return;
  // Clear simulated traffic so the diagram only replays real orders in live mode
  if (mode === 'live') this.sim.reset();
  this.modes.mode.set(mode);
}

send(): void {
  // …simulated mode calls this.sim.submitOrder and returns
  this.api.createOrder(customerEmail, total).subscribe({
    next: (res) => {
      this.liveResult.set({ status: res.status, location: res.headers.get('Location'), body: res.body });
      this.sim.submitOrder({ customerEmail, total, liveOrderId: res.body?.orderId });
    },
    error: (err: HttpErrorResponse) => {
      // status 0 means the request never got an answer: wrong URL, AppHost not running, or CORS
    },
  });
}
```

The page can only see what the API returns. What happens after that (SNS, SQS, the processor) runs in AWS, so
the diagram **replays** the trip with the real `orderId`, and live orders always succeed in the replay.

### 6e. Hide what doesn't apply in live mode

The queue, processor and log panels, the tuning controls and the diagram's counts only describe the
simulation, so they would disagree with AWS. They hide in live mode, e.g. in the Playground page:

```html
<!-- These show simulated state only, so they hide when orders go to the real API -->
@if (!modes.live()) {
  <div class="row two">
    <app-queue-panel />
    <app-lambda-panel />
  </div>

  <app-log-stream />
}
```

For the real numbers, use the AWS console: SQS → OrdersQueue / OrdersDeadLetterQueue, and Lambda →
OrdersProcessor → **Monitor**.

**Check it:** start the backend (`dotnet run --project src/Orders.AppHost` in `orders-serverless`), copy the
**APIGatewayEmulator** URL from the Aspire dashboard into **API base URL**, switch to **Live API** and send an
order → a green **202 Accepted** with an `orderId`, and the OrdersProcessor logs in the dashboard show
`Processing order <that id> …`.

---

## Step 7: Load the API URL from `.env`

The app runs in the browser, which can't read files on your disk. So a script copies the one setting the page
needs from `.env` into `public/env.json`, a static file the page can fetch.

### 7a. Write `scripts/write-env.mjs`

```javascript
// Copies the browser-safe settings from .env / .env.local into public/env.json,
// because the app runs in the browser and cannot read .env files itself.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const root = new URL('../', import.meta.url);
const files = ['.env', '.env.local']; // later files win

const env = {};
for (const name of files) {
  const file = new URL(name, root);
  if (existsSync(file)) Object.assign(env, parseEnv(readFileSync(file, 'utf8')));
}

// Only allowlisted keys reach the browser; everything else in .env stays private
const output = {};
if (env.ORDERS_API_BASE_URL) output.ordersApiBaseUrl = env.ORDERS_API_BASE_URL;

writeFileSync(new URL('public/env.json', root), JSON.stringify(output, null, 2) + '\n');
console.log(`public/env.json: ${output.ordersApiBaseUrl ? `ordersApiBaseUrl=${output.ordersApiBaseUrl}` : 'no ORDERS_API_BASE_URL set'}`);
```

Only `ORDERS_API_BASE_URL` is copied. Anything in `public/` is downloadable by anyone who opens the site, so
secrets in `.env` must never reach it.

### 7b. Run it before `start` and `build`

In `package.json`:

```json
"scripts": {
  "ng": "ng",
  "env": "node scripts/write-env.mjs",
  "prestart": "npm run env",
  "start": "ng serve",
  "prebuild": "npm run env",
  "build": "ng build",
  ...
}
```

npm runs `prestart` before `start` and `prebuild` before `build` automatically. Running `ng serve` directly skips
it; use `npm start`, or `npm run env` after editing `.env`.

### 7c. Example file and `.gitignore`

`.env.example` (committed):

```bash
# Copy to .env (or .env.local) and run `npm start` or `npm run build`.
# Only the keys below are copied into public/env.json for the browser.

# Base URL of Orders.Api: the API Gateway emulator URL from the Aspire dashboard, or a deployed HTTP API
ORDERS_API_BASE_URL=http://localhost:5050
```

Add to `.gitignore`:

```
# Environment
.env
.env.local
/public/env.json
```

### 7d. Find the deployed API's URL

If you did Step 6e of the backend guide, the URL is the `orders-api` HTTP API's endpoint:

```bash
aws apigatewayv2 get-apis --profile youtube-demo --region ca-central-1 \
  --query "Items[?Name=='orders-api'].ApiEndpoint" --output text
```

or API Gateway console → **orders-api** → **Invoke URL**. Put it in `.env` without `/orders`:

```bash
ORDERS_API_BASE_URL=https://<api-id>.execute-api.ca-central-1.amazonaws.com
```

**Check it:** `npm run env` prints `public/env.json: ordersApiBaseUrl=…`. In the app, **Live API** → **Load from
.env** fills in the URL and shows `Loaded … from .env`.

---

## Step 8: Pages, routing and the sidebar

### 8a. Two pages: `src/app/pages/`

- `playground-page.ts`: the intro heading, `<app-flow-diagram />`, the order form and tuning controls, the
  queue and processor panels and the log stream (with the live-mode `@if` from Step 6e).
- `how-it-works-page.ts`: a heading and `<app-explainer />`.

### 8b. Routes: `src/app/app.routes.ts`

```typescript
import { Routes } from '@angular/router';
import { PlaygroundPage } from './pages/playground-page';
import { HowItWorksPage } from './pages/how-it-works-page';

export const routes: Routes = [
  { path: '', component: PlaygroundPage, title: 'Playground · orders.pipeline' },
  { path: 'how-it-works', component: HowItWorksPage, title: 'How it works · orders.pipeline' },
  { path: '**', redirectTo: '' },
];
```

`title` sets the browser tab's title for each page.

### 8c. App config: `src/app/app.config.ts`

```typescript
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    // Hash URLs (/#/how-it-works) work on static hosting like S3 without rewrite rules
    provideRouter(routes, withHashLocation()),
  ]
};
```

With normal URLs, reloading `/how-it-works` asks the server for a file that doesn't exist, so a static host
returns 404 unless you add a rewrite rule. With `#` URLs the server always serves `index.html`, and the router
reads the part after `#`.

### 8d. The sidebar: `src/app/app.html`

```html
<!-- Hidden sidebar comes back when the pointer reaches the left edge, or from the menu button -->
<div class="sidebar-edge" aria-hidden="true" (mouseenter)="showSidebar()"></div>
<button #menuToggle class="menu-toggle" type="button" aria-label="Show menu" aria-controls="sidebar"
        [attr.aria-expanded]="!sidebarHidden()" (click)="showSidebar()">☰</button>

<aside id="sidebar" class="sidebar" [inert]="sidebarHidden()"
       (mouseenter)="keepSidebar()" (mouseleave)="scheduleHide()"
       (focusin)="keepSidebar()" (focusout)="scheduleHide()">
  <div class="sidebar-head">
    <a class="wordmark" routerLink="/"><span class="mark">λ</span><span>orders<span class="accent">.</span>pipeline</span></a>
    <button class="sidebar-hide" type="button" aria-label="Hide menu" title="Hide menu" aria-controls="sidebar" (click)="hideSidebar()">«</button>
  </div>
  <nav class="menu" aria-label="Pages">
    <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" ariaCurrentWhenActive="page">
      <span class="icon" aria-hidden="true">▶</span>Playground
    </a>
    <a routerLink="/how-it-works" routerLinkActive="active" ariaCurrentWhenActive="page">
      <span class="icon" aria-hidden="true">≡</span>How it works
    </a>
  </nav>
</aside>

<div class="content">
  <main class="page">
    <router-outlet />
  </main>
  <footer class="footer caption">…</footer>
</div>
```

- `routerLinkActive="active"` highlights the current page; `exact: true` stops `/` matching every URL.
- `inert` removes the hidden sidebar's links from the Tab order, so keyboard users can't tab into something
  off-screen.

### 8e. Auto-hide: `src/app/app.ts`

```typescript
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
```

- The host class `sidebar-hidden` drives everything in `app.scss`: the sidebar slides out with
  `transform: translateX(-100%)`, the content's left margin goes to 0, and the ☰ button fades in.
- On phones (under 768px) the sidebar is a top bar instead. `wide` keeps it from ever hiding there.

**Check it:** `npm start` → the sidebar disappears after 3 seconds; moving the mouse to the left edge or clicking ☰
brings it back; **«** hides it at once; **How it works** changes the page and the URL to `/#/how-it-works`.

---

## Step 9: Run and test

```bash
npm start                      # runs scripts/write-env.mjs, then ng serve on http://localhost:4200
npm test -- --watch=false      # unit tests (Vitest)
```

`src/app/app.spec.ts` uses `RouterTestingHarness` to open each route and check its heading:

```typescript
it('should render the how it works page', async () => {
  const harness = await RouterTestingHarness.create('/how-it-works');
  expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('Four steps');
});
```

**Check it:**
- `npm test -- --watch=false` → `Tests  3 passed (3)`.
- **Simulated:** **Send poison message** → it fails 3 times (receives 1/3, 2/3, 3/3) and lands in the
  dead-letter queue. Raise **Failure rate** to 50% and **Send 10 orders** → some retry, then succeed.
- **Live API:** a 202 with an `orderId`, and the processor logs it:

```bash
aws logs tail /aws/lambda/OrdersProcessor --since 5m --follow --profile youtube-demo --region ca-central-1
```

---

## Step 10: Build for production (optional)

```bash
npm run build
```

The site is the static files in `dist/orders-visualizer/browser/` (`index.html`, hashed `.js` and `.css`,
`env.json`). Any static host can serve them, an S3 bucket included; no rewrite rules are needed thanks to the
`#` URLs.

Before hosting it anywhere other than `http://localhost:4200`, add that origin to `WithOrigins(...)` in
`Orders.Api/Program.cs` (Step 6a) and redeploy the API, or the browser will block Live API calls.

---

## Clean up

The frontend creates nothing in AWS. Stop `npm start` with Ctrl+C. To clean up the backend resources it talks
to, see **Clean up** in `../orders-serverless/how-to-build.md`.
