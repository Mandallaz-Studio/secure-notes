/**
 * Le peu d'API WebExtensions dont l'extension a besoin, typé à la main.
 * Firefox expose `browser` (promesses), Chrome et Edge `chrome`.
 */

type WebExtensionApi = {
  tabs: { create(properties: { url: string }): Promise<unknown> };
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string[]): Promise<void>;
    };
  };
  runtime: { openOptionsPage(): Promise<void> };
};

const scope = globalThis as unknown as { browser?: WebExtensionApi; chrome?: WebExtensionApi };

export const ext: WebExtensionApi = (scope.browser ?? scope.chrome)!;
