import { Component } from '@angular/core';
import { Explainer } from '../components/explainer';

@Component({
  selector: 'app-how-it-works-page',
  imports: [Explainer],
  template: `
    <header class="intro">
      <span class="eyebrow">How it works</span>
      <h1 class="display-xl title">Four steps, each in its own service</h1>
      <p class="body-lg mute lead">
        The same code you have in <code>orders-serverless/src</code>, explained one hop at a time.
      </p>
    </header>
    <app-explainer />
  `,
  styles: `
    .intro { padding-bottom: var(--space-huge); }
    .title { max-width: 760px; }
    .lead { max-width: 680px; margin-top: var(--space-xl); }
    .lead code { font-size: 15px; }
    @media (max-width: 767px) {
      .intro { padding-bottom: var(--space-xxl); }
    }
  `,
})
export class HowItWorksPage {}
