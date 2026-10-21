import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

const STORAGE_KEY = 'orders-api-base-url';
const FROM_ENV_KEY = 'orders-api-base-url-from-env';

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

  readonly baseUrl = signal(readStored(STORAGE_KEY) ?? 'http://localhost:5050');
  /** True when the URL came from .env; the page then shows it masked */
  readonly fromEnv = signal(readStored(FROM_ENV_KEY) === 'true');
  /**
   * What the page shows. Masking only keeps the URL off screens and screenshots: the browser still has to call it,
   * so it stays visible in env.json and the network tab.
   */
  readonly displayUrl = computed(() => (this.fromEnv() ? maskUrl(this.baseUrl()) : this.baseUrl()));

  setBaseUrl(url: string, fromEnv = false): void {
    this.baseUrl.set(url);
    this.fromEnv.set(fromEnv);
    try {
      localStorage.setItem(STORAGE_KEY, url);
      localStorage.setItem(FROM_ENV_KEY, String(fromEnv));
    } catch {
      // storage unavailable (private mode); the value just won't persist
    }
  }

  /** Reads ORDERS_API_BASE_URL, copied from .env into env.json by scripts/write-env.mjs */
  loadBaseUrlFromEnv(): Observable<string | null> {
    return this.http.get<EnvConfig>('env.json').pipe(
      map((env) => env.ordersApiBaseUrl ?? null),
      tap((url) => url && this.setBaseUrl(url, true)),
    );
  }

  createOrder(customerEmail: string, total: number): Observable<HttpResponse<CreateOrderResponse>> {
    const url = `${this.baseUrl().replace(/\/+$/, '')}/orders`;
    return this.http
      .post<CreateOrderResponse>(url, { customerEmail, total }, { observe: 'response' })
      .pipe(tap({ error: (err) => console.error('POST /orders failed', err) }));
  }
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** https://abc123xyz.execute-api.ca-central-1.amazonaws.com → https://ab••••••.amazonaws.com */
export function maskUrl(url: string): string {
  try {
    const { protocol, hostname } = new URL(url);
    const labels = hostname.split('.');
    const domain = labels.length > 2 ? '.' + labels.slice(-2).join('.') : '';
    return `${protocol}//${labels[0].slice(0, 2)}••••••${domain}`;
  } catch {
    return '••••••';
  }
}
