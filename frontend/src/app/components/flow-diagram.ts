import { Component, computed, inject } from '@angular/core';
import { SimulationService } from '../simulation.service';
import { ModeService } from '../mode.service';
import { Stage, Token } from '../models';

interface NodeDef {
  id: Stage;
  x: number;
  y: number;
  title: string;
  subtitle: string;
  glyph: string;
}

const NODE_W = 132;
const NODE_H = 76;
const ROW_Y = 120;

const NODES: NodeDef[] = [
  { id: 'client', x: 72, y: ROW_Y, title: 'Client', subtitle: 'POST /orders', glyph: '⌘' },
  { id: 'gateway', x: 248, y: ROW_Y, title: 'API Gateway', subtitle: 'HTTP API', glyph: '⇄' },
  { id: 'api', x: 424, y: ROW_Y, title: 'Orders.Api', subtitle: 'Lambda', glyph: 'λ' },
  { id: 'sns', x: 600, y: ROW_Y, title: 'OrdersTopic', subtitle: 'SNS', glyph: '◎' },
  { id: 'sqs', x: 776, y: ROW_Y, title: 'OrdersQueue', subtitle: 'SQS', glyph: '≡' },
  { id: 'processor', x: 952, y: ROW_Y, title: 'Orders.Processor', subtitle: 'Lambda', glyph: 'λ' },
  { id: 'dlq', x: 776, y: 262, title: 'Dead-letter', subtitle: 'SQS DLQ', glyph: '⚠' },
];

const nodeById = new Map(NODES.map((n) => [n.id, n]));

interface Point {
  x: number;
  y: number;
}

/** The two curved edges; every other edge is a straight line between box sides */
function control(from: Stage, to: Stage): Point | null {
  if (from === 'processor' && to === 'sqs') return { x: 864, y: ROW_Y - 110 };
  if (from === 'api' && to === 'client') return { x: 248, y: ROW_Y + 110 };
  return null;
}

function endpoints(from: Stage, to: Stage): [Point, Point] {
  const a = nodeById.get(from)!;
  const b = nodeById.get(to)!;
  if (a.x === b.x) {
    const dir = Math.sign(b.y - a.y);
    return [
      { x: a.x, y: a.y + (dir * NODE_H) / 2 },
      { x: b.x, y: b.y - (dir * NODE_H) / 2 },
    ];
  }
  if (control(from, to)) {
    const dy = from === 'processor' ? -NODE_H / 2 : NODE_H / 2;
    return [
      { x: a.x, y: a.y + dy },
      { x: b.x, y: b.y + dy },
    ];
  }
  const dir = Math.sign(b.x - a.x);
  return [
    { x: a.x + (dir * NODE_W) / 2, y: a.y },
    { x: b.x - (dir * NODE_W) / 2, y: b.y },
  ];
}

function pointAt(from: Stage, to: Stage, t: number): Point {
  const [p0, p1] = endpoints(from, to);
  const c = control(from, to);
  if (!c) return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  };
}

function pathFor(from: Stage, to: Stage): string {
  const [p0, p1] = endpoints(from, to);
  const c = control(from, to);
  return c ? `M${p0.x},${p0.y} Q${c.x},${c.y} ${p1.x},${p1.y}` : `M${p0.x},${p0.y} L${p1.x},${p1.y}`;
}

const EDGES: { from: Stage; to: Stage; label: string; dashed?: boolean }[] = [
  { from: 'client', to: 'gateway', label: 'HTTPS' },
  { from: 'gateway', to: 'api', label: 'invoke' },
  { from: 'api', to: 'sns', label: 'publish' },
  { from: 'sns', to: 'sqs', label: 'deliver' },
  { from: 'sqs', to: 'processor', label: 'poll' },
  { from: 'sqs', to: 'dlq', label: 'maxReceiveCount', dashed: true },
  { from: 'processor', to: 'sqs', label: 'BatchItemFailures → retry', dashed: true },
  { from: 'api', to: 'client', label: '202 Accepted', dashed: true },
];

@Component({
  selector: 'app-flow-diagram',
  template: `
    <div class="pane-wrap">
      <div class="scroller">
        <svg viewBox="0 0 1028 320" role="img" aria-label="Order flow: client to API Gateway to Orders.Api Lambda to SNS to SQS to Orders.Processor Lambda, with a dead-letter queue">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" class="arrow-head" />
            </marker>
          </defs>

          @for (e of edges; track e.from + e.to) {
            <path [attr.d]="e.path" class="edge" [class.dashed]="e.dashed" marker-end="url(#arrow)" />
            <text [attr.x]="e.labelAt.x" [attr.y]="e.labelAt.y" class="edge-label" text-anchor="middle">{{ e.label }}</text>
          }

          @for (n of nodes; track n.id) {
            <g [attr.transform]="'translate(' + (n.x - nodeW / 2) + ',' + (n.y - nodeH / 2) + ')'"
               class="node" [class.active]="sim.activeStages().has(n.id)" [class.lambda]="n.glyph === 'λ'"
               [class.danger]="n.id === 'dlq' && sim.deadLettered().length > 0">
              <rect [attr.width]="nodeW" [attr.height]="nodeH" rx="12" />
              <text [attr.x]="nodeW - 12" y="47" class="glyph" text-anchor="end">{{ n.glyph }}</text>
              <text x="12" y="27" class="title">{{ n.title }}</text>
              <text x="12" y="46" class="subtitle">{{ n.subtitle }}</text>
              <!-- Simulated counts; hidden in live mode because they wouldn't match the real queues -->
              @if (!modes.live()) {
                @if (n.id === 'sqs') {
                  <text x="12" y="64" class="badge">{{ sim.visible().length }} ready · {{ sim.inFlight().length }} hidden</text>
                }
                @if (n.id === 'processor') {
                  <text x="12" y="64" class="badge">{{ sim.currentInvocation() ? 'running batch #' + sim.currentInvocation()!.id : 'idle' }}</text>
                }
                @if (n.id === 'dlq') {
                  <text x="12" y="64" class="badge">{{ sim.deadLettered().length }} message{{ sim.deadLettered().length === 1 ? '' : 's' }}</text>
                }
              }
            </g>
          }

          @for (t of tokenPositions(); track t.id) {
            <g [attr.transform]="'translate(' + t.x + ',' + t.y + ')'" [attr.class]="'token ' + t.kind">
              <circle r="7" />
              @if (t.showLabel) { <text y="-13" text-anchor="middle">{{ t.label }}</text> }
            </g>
          }
        </svg>
      </div>
      <div class="legend caption">
        <span><i class="swatch ok"></i>message / event</span>
        <span><i class="swatch response"></i>HTTP response</span>
        <span><i class="swatch fail"></i>retry / dead-letter</span>
      </div>
    </div>
  `,
  styles: `
    .pane-wrap {
      background: var(--canvas);
      border: 1px solid var(--hairline);
      border-radius: var(--rounded-lg);
      box-shadow: var(--shadow-2);
      padding: var(--space-lg);
    }
    .scroller { overflow-x: auto; }
    svg { display: block; width: 100%; min-width: 760px; height: auto; }
    .edge { fill: none; stroke: var(--hairline-strong); stroke-width: 1.5; }
    .edge.dashed { stroke-dasharray: 5 5; }
    .arrow-head { fill: var(--hairline-strong); }
    .edge-label { font-size: 10.5px; fill: var(--ink-mute-2); }
    .node rect { fill: var(--canvas); stroke: var(--hairline); stroke-width: 1; transition: stroke 150ms; }
    .node.lambda rect { fill: var(--canvas-soft); }
    .node.active rect { stroke: var(--primary); stroke-width: 2; }
    .node.danger rect { stroke: var(--accent-tomato); stroke-width: 2; }
    .glyph { font-size: 16px; fill: var(--ink); font-weight: 500; }
    .node.active .glyph { fill: var(--primary-deep); }
    .title { font-size: 12.5px; font-weight: 500; fill: var(--ink); }
    .subtitle { font-size: 12px; fill: var(--ink-mute); }
    .badge { font-size: 10px; fill: var(--ink-mute); font-family: var(--font-mono); }
    .token circle { stroke: var(--canvas); stroke-width: 2; }
    .token text { font-size: 11px; font-weight: 500; fill: var(--ink); paint-order: stroke; stroke: var(--canvas); stroke-width: 3px; }
    .token.ok circle { fill: var(--primary); }
    .token.fail circle { fill: var(--accent-tomato); }
    .token.response circle { fill: var(--ink); }
    .legend { display: flex; flex-wrap: wrap; gap: var(--space-lg); margin-top: var(--space-md); color: var(--ink-mute); }
    .legend span { display: inline-flex; align-items: center; gap: var(--space-xs); }
    .swatch { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .swatch.ok { background: var(--primary); }
    .swatch.fail { background: var(--accent-tomato); }
    .swatch.response { background: var(--ink); }
  `,
})
export class FlowDiagram {
  protected readonly sim = inject(SimulationService);
  protected readonly modes = inject(ModeService);
  protected readonly nodes = NODES;
  protected readonly nodeW = NODE_W;
  protected readonly nodeH = NODE_H;

  protected readonly edges = EDGES.map((e) => {
    const mid = pointAt(e.from, e.to, 0.5);
    const vertical = nodeById.get(e.from)!.x === nodeById.get(e.to)!.x;
    return {
      ...e,
      path: pathFor(e.from, e.to),
      labelAt: vertical ? { x: mid.x + 54, y: mid.y + 4 } : { x: mid.x, y: mid.y + (e.from === 'processor' ? -8 : control(e.from, e.to) ? 16 : -8) },
    };
  });

  protected readonly tokenPositions = computed(() => {
    const now = this.sim.now();
    // Only the newest token on each edge gets a label, and only mid-hop, so bursts stay readable
    const labelled = new Map<string, number>();
    for (const t of this.sim.tokens()) labelled.set(t.from + t.to, t.id);
    return this.sim.tokens().map((t: Token) => {
      const progress = Math.min(1, Math.max(0, (now - t.startedAt) / t.duration));
      const showLabel = labelled.get(t.from + t.to) === t.id && progress > 0.15 && progress < 0.85;
      return { ...t, showLabel, ...pointAt(t.from, t.to, ease(progress)) };
    });
  });
}

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
