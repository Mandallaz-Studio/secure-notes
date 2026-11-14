/**
 * Bourrage des textes JSON avant chiffrement.
 *
 * Un chiffré a la taille du texte clair (plus 40 octets) : sans bourrage, le
 * serveur distinguerait une suppression (quelques dizaines d'octets) d'une
 * catégorie ou d'une note, et suivrait la longueur exacte de chaque note.
 *
 * Le texte est complété par des espaces, que `JSON.parse` ignore : les
 * versions de l'app qui ne bourrent pas lisent les nouveaux messages, et
 * inversement. Le format chiffré ne change donc pas.
 *
 * Taille cible : au moins `minBytes`, puis arrondie selon Padmé (Nikitin et
 * al., 2019) — au plus 12 % de surcoût, et une taille ne révèle qu'environ
 * log log de la longueur réelle.
 */

const SPACE = 0x20;

/** Longueur Padmé de `length` octets. */
export function padmeLength(length: number): number {
  if (length < 2) return length;
  const exponent = Math.floor(Math.log2(length));
  const bits = Math.floor(Math.log2(exponent)) + 1;
  const step = 2 ** (exponent - bits);
  return Math.ceil(length / step) * step;
}

/**
 * @param json Texte JSON encodé en UTF-8.
 * @param maxBytes Taille à ne pas dépasser du fait du bourrage (limite du
 *   serveur) : un texte déjà plus long n'est pas bourré.
 */
export function padJson(json: Uint8Array, minBytes: number, maxBytes = Infinity): Uint8Array {
  const target = Math.min(Math.max(minBytes, padmeLength(json.length)), Math.max(maxBytes, json.length));
  if (target <= json.length) return json;
  const padded = new Uint8Array(target).fill(SPACE);
  padded.set(json, 0);
  return padded;
}
