import { Linking } from 'react-native';
import type { WebViewProps } from 'react-native-webview';

/**
 * Garde de navigation de la WebView de l'éditeur.
 *
 * La WebView ne doit jamais quitter la page de l'éditeur : une page distante
 * chargée à sa place recevrait le canal de messages vers l'app (et pourrait se
 * faire passer pour l'éditeur). Toucher un lien d'une note, en lecture seule
 * par exemple, l'ouvrirait pourtant dans la WebView. Seule la page de
 * l'éditeur (HTML chargé en ligne : `about:`, `data:`) est donc admise ; un
 * lien web s'ouvre dans le navigateur, tout le reste est refusé.
 */

const EDITOR_PAGE = /^(about:|data:)/i;
const WEB_LINK = /^https?:\/\//i;

function openOutside(url: string) {
  if (WEB_LINK.test(url)) void Linking.openURL(url).catch(() => {});
}

export const editorNavigationGuard: Pick<
  WebViewProps,
  'onShouldStartLoadWithRequest' | 'onOpenWindow' | 'originWhitelist'
> = {
  // Tout passe par la garde ci-dessous : une adresse hors de cette liste serait
  // confiée telle quelle au système par react-native-webview, quel que soit
  // son schéma (`intent:`, `tel:`…).
  originWhitelist: ['*'],
  onShouldStartLoadWithRequest: (request) => {
    if (EDITOR_PAGE.test(request.url)) return true;
    // Une sous-fenêtre (iframe) n'a pas à charger quoi que ce soit.
    if (request.isTopFrame !== false) openOutside(request.url);
    return false;
  },
  // `target="_blank"` / `window.open` : jamais de nouvelle fenêtre.
  onOpenWindow: (event) => openOutside(event.nativeEvent.targetUrl),
};
