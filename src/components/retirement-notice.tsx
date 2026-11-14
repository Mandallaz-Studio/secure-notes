import { Button } from '@/components/button';
import { Notice } from '@/components/notice';
import { useSync } from '@/sync/sync-context';

/** Avancement du retrait de l'ancien coffre ; rien quand il n'y en a pas. */
export function RetirementNotice() {
  const { retirement, retryRetirement } = useSync();

  switch (retirement.state) {
    case 'none':
      return null;
    case 'waiting':
      return (
        <Notice tone="info" title="Ancien coffre : en attente">
          {retirement.detail}
        </Notice>
      );
    case 'running':
      return <Notice tone="info" title="Ancien coffre : fermeture de l’ancien compte en cours…" />;
    case 'error':
      return (
        <Notice
          tone="danger"
          title="Fermeture de l’ancien compte en échec"
          action={<Button size="sm" label="Réessayer maintenant" onPress={retryRetirement} />}>
          {retirement.error}. Elle sera retentée à la prochaine synchronisation.
        </Notice>
      );
    case 'done': {
      const { sharesMoved, sharesRevoked, sharesTaken } = retirement.report;
      return (
        <>
          <Notice tone="success" title="Ancien coffre retiré">
            Son compte est vidé et fermé.
            {sharesMoved > 0 && ` ${sharesMoved} lien(s) de partage repris par le nouveau compte.`}
            {sharesRevoked > 0 && ` ${sharesRevoked} lien(s) de partage révoqué(s).`}
          </Notice>
          {sharesTaken > 0 && (
            <Notice tone="danger" title="Liens de partage détournés">
              {`${sharesTaken} lien(s) ont été repris par un autre compte pendant le transfert : ils n’affichent plus votre note mais un contenu que vous ne contrôlez pas. Prévenez leurs destinataires de ne plus s’y fier.`}
            </Notice>
          )}
        </>
      );
    }
  }
}
