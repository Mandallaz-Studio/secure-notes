import { cryptoReady } from '@/crypto/aead';
import { hostOf } from '@/share/config';
import {
  createReceiver,
  HANDOFF_POLL_MS,
  HandoffError,
  openHandoff,
  takeHandoff,
  wipeReceiver,
  type HandoffReceiver,
} from '@/share/handoff';
import type { ShareInstance } from '@/share/link';
import { QR_QUIET_ZONE, qrPath } from '@/share/qr-path';

import { ext } from './browser';
import { READER_SITE, receivingInstance } from './settings';

/**
 * Fenêtre de l'extension : affiche un QR code de réception, relève le dépôt
 * du téléphone et ouvre la note sur le site de lecture.
 *
 * Les secrets du QR code ne vivent que dans cette fenêtre : la fermer les
 * efface, et le code ne peut plus servir.
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const qr = $<HTMLElement>('qr');
const veil = $<HTMLElement>('veil');
const veilText = $<HTMLElement>('veil-text');
const renew = $<HTMLButtonElement>('renew');
const status = $<HTMLElement>('status');
const error = $<HTMLElement>('error');
const server = $<HTMLElement>('server');

let receiver: HandoffReceiver | null = null;
let instance: ShareInstance | null = null;
/** Adresse de l'instance à annoncer dans le QR code (`null` : celle par défaut). */
let announced: string | null = null;
/** Incrémenté à chaque nouveau code : une relève en cours pour un ancien code s'arrête. */
let generation = 0;

const SVG = 'http://www.w3.org/2000/svg';

function drawQr(text: string): void {
  const { size, d } = qrPath(text);
  const full = size + 2 * QR_QUIET_ZONE;
  qr.setAttribute('viewBox', `${-QR_QUIET_ZONE} ${-QR_QUIET_ZONE} ${full} ${full}`);
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  qr.replaceChildren(path);
}

function showVeil(text: string, canRenew: boolean): void {
  qr.replaceChildren();
  veilText.textContent = text;
  renew.hidden = !canRenew;
  veil.hidden = false;
}

function showError(text: string | null): void {
  error.textContent = text ?? '';
  error.hidden = text === null;
}

function setStatus(text: string, tone: 'default' | 'success' = 'default'): void {
  status.textContent = text;
  status.classList.toggle('success', tone === 'success');
}

function discard(): void {
  generation += 1;
  if (receiver) wipeReceiver(receiver);
  receiver = null;
}

const remaining = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

async function poll(current: number): Promise<void> {
  while (current === generation && receiver && instance) {
    const now = Date.now();
    if (now >= receiver.expiresAt) {
      discard();
      showVeil('Ce code a expiré.', true);
      setStatus('');
      return;
    }
    setStatus(`En attente du téléphone · expire dans ${remaining(receiver.expiresAt - now)}`);
    let payload: string | null = null;
    try {
      payload = await takeHandoff(instance, receiver.channel);
      showError(null);
    } catch (cause) {
      // Erreur passagère (réseau) : on réessaie jusqu'à l'expiration du code.
      showError(cause instanceof HandoffError ? cause.message : 'Relève impossible.');
    }
    if (current !== generation || !receiver) return;
    if (payload !== null) {
      await receive(receiver, payload);
      return;
    }
    await new Promise((done) => setTimeout(done, HANDOFF_POLL_MS));
  }
}

async function receive(from: HandoffReceiver, payload: string): Promise<void> {
  let link: string;
  try {
    const message = openHandoff(from, payload);
    link = `${READER_SITE.replace(/\/+$/, '')}/s/${message.id}#${message.fragment}`;
  } catch (cause) {
    discard();
    showVeil('Le message reçu a été refusé.', true);
    setStatus('');
    showError(
      cause instanceof HandoffError
        ? `${cause.message} Affichez un nouveau code et scannez-le à nouveau.`
        : 'Message illisible.',
    );
    return;
  } finally {
    wipeReceiver(from);
  }
  discard();
  showVeil('Note reçue.', false);
  setStatus('Ouverture dans un nouvel onglet…', 'success');
  await ext.tabs.create({ url: link });
  window.close();
}

async function start(): Promise<void> {
  discard();
  showError(null);
  if (!instance) return;
  receiver = createReceiver(announced, Date.now());
  drawQr(receiver.text);
  veil.hidden = true;
  await poll(generation);
}

async function init(): Promise<void> {
  await cryptoReady();
  if (!/^https:\/\//.test(READER_SITE)) {
    showVeil('Extension mal compilée : aucun site de lecture.', false);
    setStatus('');
    return;
  }
  const where = await receivingInstance();
  if (!where) {
    showVeil('Aucun serveur configuré.', false);
    setStatus('Indiquez votre instance dans les réglages.');
    return;
  }
  instance = where.instance;
  announced = where.announced;
  server.textContent = `Serveur : ${hostOf(instance.url)}`;
  await start();
}

renew.addEventListener('click', () => void start());
$<HTMLButtonElement>('options').addEventListener('click', () => {
  void ext.runtime.openOptionsPage();
  window.close();
});
window.addEventListener('pagehide', discard);

void init();
