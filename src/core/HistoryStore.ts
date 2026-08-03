export interface HistoryEntry {
  id: string;
  timestamp: number;
  text: string;
  code: string;
}

export class HistoryStore {
  private static readonly STORAGE_KEY = 'tmx_history';

  static getHistory(): HistoryEntry[] {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as HistoryEntry[];
    } catch {
      return [];
    }
  }

  static addHistory(text: string, code: string): void {
    const entries = this.getHistory();
    entries.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      timestamp: Date.now(),
      text,
      code
    });
    // Keep max 100 history items
    if (entries.length > 100) {
      entries.length = 100;
    }
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(entries));
    window.dispatchEvent(new CustomEvent('tmx-history-changed'));
  }

  static removeHistory(id: string): void {
    const entries = this.getHistory().filter(e => e.id !== id);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(entries));
    window.dispatchEvent(new CustomEvent('tmx-history-changed'));
  }

  static installFetchInterceptor(): void {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const arg0 = args[0] as any;
      const requestUrl = (typeof arg0 === 'string' ? arg0 : (arg0?.url || arg0?.href)) || '';
      const requestOpts = args[1];

      // Call actual fetch
      const response = await originalFetch(...args);

      try {
        if (requestUrl.includes('/comment') && requestOpts?.method === 'POST') {
          if (response.ok) {
            if (requestOpts.body && typeof requestOpts.body === 'string') {
              const body = JSON.parse(requestOpts.body);
              const text = body.comment || '';
              
              // Extract the music code (TMX_v2 string)
              const match = text.match(/TMX_v2(?:\|[0-9a-zA-Z\.,\-]+)+/);
              if (match) {
                this.addHistory(text, match[0]);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Failed to intercept Waline fetch for history:', err);
      }

      return response;
    };
  }
}
