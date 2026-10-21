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
