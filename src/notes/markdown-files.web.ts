/** Le web ne sert qu'à lire les notes partagées : ni import ni export de fichiers. */
export const markdownFilesSupported = false;

export async function shareMarkdown(_title: string, _markdown: string): Promise<void> {
  throw new Error("L'export n'est pas disponible sur le web.");
}

export async function pickTextFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  throw new Error("L'import n'est pas disponible sur le web.");
}
