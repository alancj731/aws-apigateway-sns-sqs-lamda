import { Routes } from '@angular/router';
import { PlaygroundPage } from './pages/playground-page';
import { HowItWorksPage } from './pages/how-it-works-page';

export const routes: Routes = [
  { path: '', component: PlaygroundPage, title: 'Playground · orders.pipeline' },
  { path: 'how-it-works', component: HowItWorksPage, title: 'How it works · orders.pipeline' },
  { path: '**', redirectTo: '' },
];
