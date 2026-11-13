import type { BodyContent, NoteStore } from '@/notes/types';

export type NoteBodyHandle = {
  /**
   * Contenu actuel, lu dans l'éditeur à l'instant de l'appel ; `null` si
   * l'éditeur n'est pas prêt. À appeler avant une action qui ferme l'écran,
   * pour ne pas perdre les dernières frappes.
   */
  read: () => Promise<BodyContent | null>;
};

export type NoteBodyProps = {
  /** Contenu à l'ouverture ; les changements ultérieurs de cette prop sont ignorés. */
  initial: BodyContent;
  editable: boolean;
  /** Base ouverte : les images du texte y sont lues et enregistrées. */
  store: NoteStore;
  /** Appelé après chaque modification faite par l'utilisateur. */
  onChange: (content: BodyContent) => void;
  ref?: React.Ref<NoteBodyHandle>;
};
