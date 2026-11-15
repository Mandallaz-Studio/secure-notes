import { defaultInstance, hostOf } from '@/share/config';
import { takeHandoff } from '@/share/handoff';

import { loadCustomInstance, normalizeUrl, READER_SITE, saveCustomInstance } from './settings';

/** Réglages : instance Supabase où relever les liens (auto-hébergement). */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('form');
const urlInput = $<HTMLInputElement>('url');
const anonInput = $<HTMLInputElement>('anon-key');
const message = $<HTMLElement>('message');

const fallback = defaultInstance();
$<HTMLElement>('default-host').textContent = fallback ? hostOf(fallback.url) : 'aucun';
$<HTMLElement>('site').textContent = READER_SITE ? hostOf(READER_SITE) : '—';

function say(text: string, tone: 'default' | 'success' | 'danger' = 'default'): void {
  message.textContent = text;
  message.className = tone === 'default' ? 'notice' : `notice ${tone}`;
  message.hidden = false;
}

async function fill(): Promise<void> {
  const custom = await loadCustomInstance();
  urlInput.value = custom?.url ?? '';
  anonInput.value = custom?.anonKey ?? '';
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    const rawUrl = urlInput.value.trim();
    const anonKey = anonInput.value.trim();
    if (rawUrl === '' && anonKey === '') {
      await saveCustomInstance(null);
      say('Serveur de Secure Notes rétabli.', 'success');
      return;
    }
    const url = normalizeUrl(rawUrl);
    if (!url) {
      say('Adresse invalide : elle doit commencer par https://.', 'danger');
      return;
    }
    if (anonKey === '') {
      say('Indiquez aussi la clé publique de l’instance.', 'danger');
      return;
    }
    say('Vérification…');
    try {
      // Un canal qui n'existe pas : l'instance doit répondre « rien ».
      await takeHandoff({ url, anonKey }, 'A'.repeat(43));
    } catch (cause) {
      say(cause instanceof Error ? cause.message : 'Instance injoignable.', 'danger');
      return;
    }
    await saveCustomInstance({ url, anonKey });
    urlInput.value = url;
    say(`Enregistré : les liens seront relevés sur ${hostOf(url)}.`, 'success');
  })();
});

$<HTMLButtonElement>('reset').addEventListener('click', () => {
  void (async () => {
    await saveCustomInstance(null);
    await fill();
    say('Serveur de Secure Notes rétabli.', 'success');
  })();
});

void fill();
