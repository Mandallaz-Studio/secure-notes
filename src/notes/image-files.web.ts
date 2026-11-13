/** Le web ne sert qu'à lire les notes partagées : pas d'ajout d'images. */
export const imagesSupported = false;

export async function pickImage(): Promise<string | null> {
  throw new Error("L'ajout d'images n'est pas disponible sur le web.");
}
