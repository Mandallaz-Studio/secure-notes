import { cryptoReady, fromBase64, generateKey, toBase64, utf8Encode } from '@/crypto/aead';
import { newBoxKeyPair, sealTo } from '@/crypto/box';
import { newId } from '@/notes/model';
import {
  createReceiver,
  HANDOFF_TTL_MS,
  HandoffError,
  OFFER_PREFIX,
  openHandoff,
  parseOffer,
  sealHandoff,
  takeHandoff,
  wipeReceiver,
} from '@/share/handoff';
import { buildShareFragment, splitShareLink } from '@/share/link';
import { SupabaseRemote, SyncError } from '@/sync/supabase';

beforeAll(async () => {
  await cryptoReady();
});

const message = () => ({ id: newId(), fragment: buildShareFragment(generateKey(), null) });

describe('envoi par QR code', () => {
  it('fait passer un lien de l’app qui scanne à l’afficheur', () => {
    const receiver = createReceiver(null, 1000);
    expect(receiver.text.startsWith(OFFER_PREFIX)).toBe(true);
    expect(receiver.expiresAt).toBe(1000 + HANDOFF_TTL_MS);
    const offer = parseOffer(receiver.text);
    expect(offer).not.toBeNull();
    const sent = message();
    const { channel, payload } = sealHandoff(offer!, sent);
    expect(channel).toBe(receiver.channel);
    expect(channel).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(payload.length).toBeLessThanOrEqual(4096);
    expect(openHandoff(receiver, payload)).toEqual(sent);
  });

  it('ne met dans le QR code ni l’identifiant du canal, ni la clé privée', () => {
    const receiver = createReceiver(null, 0);
    expect(receiver.text).not.toContain(receiver.channel);
    expect(receiver.text).not.toContain(toBase64(receiver.pair.privateKey));
  });

  it('porte l’instance de relève quand elle n’est pas celle par défaut', () => {
    const receiver = createReceiver('https://notes.example.org', 0);
    expect(parseOffer(receiver.text)?.instanceUrl).toBe('https://notes.example.org');
    expect(parseOffer(createReceiver(null, 0).text)?.instanceUrl).toBeNull();
    expect(() => createReceiver('http://notes.example.org', 0)).toThrow(HandoffError);
  });

  it('cache à la taille la présence d’une instance dans le lien', () => {
    const offer = parseOffer(createReceiver(null, 0).text)!;
    const plain = sealHandoff(offer, message()).payload;
    const withInstance = sealHandoff(offer, {
      id: newId(),
      fragment: buildShareFragment(generateKey(), {
        url: 'https://abc.supabase.co',
        anonKey: 'sb_publishable_0123456789abcdef',
      }),
    }).payload;
    expect(withInstance.length).toBe(plain.length);
  });

  it('refuse un message d’un autre QR code, ou altéré', () => {
    const receiver = createReceiver(null, 0);
    const other = parseOffer(createReceiver(null, 0).text)!;
    expect(() => openHandoff(receiver, sealHandoff(other, message()).payload)).toThrow(HandoffError);

    const { payload } = sealHandoff(parseOffer(receiver.text)!, message());
    const bytes = fromBase64(payload);
    bytes[bytes.length - 1] ^= 1;
    expect(() => openHandoff(receiver, toBase64(bytes))).toThrow(HandoffError);
  });

  it('refuse un message scellé pour la bonne clé publique sans connaître le secret', () => {
    // Qui n'a vu que la clé publique (le serveur, par exemple) ne peut rien déposer.
    const receiver = createReceiver(null, 0);
    const forged = sealTo(utf8Encode(JSON.stringify({ v: 1, ...message() })), receiver.pair.publicKey);
    expect(() => openHandoff(receiver, toBase64(forged))).toThrow(HandoffError);
  });

  it('ne s’ouvre plus une fois les secrets effacés', () => {
    const receiver = createReceiver(null, 0);
    const { payload } = sealHandoff(parseOffer(receiver.text)!, message());
    wipeReceiver(receiver);
    expect(() => openHandoff(receiver, payload)).toThrow(HandoffError);
  });

  it('refuse d’envoyer autre chose qu’un lien de partage', () => {
    const offer = parseOffer(createReceiver(null, 0).text)!;
    expect(() => sealHandoff(offer, { id: 'pas-un-uuid', fragment: message().fragment })).toThrow(
      HandoffError,
    );
    expect(() => sealHandoff(offer, { id: newId(), fragment: 'abc' })).toThrow(HandoffError);
  });

  it('ignore les QR codes qui ne sont pas de Secure Notes', () => {
    const valid = createReceiver(null, 0).text;
    expect(parseOffer('https://example.org')).toBeNull();
    expect(parseOffer(`${OFFER_PREFIX}abc`)).toBeNull();
    expect(parseOffer(`${valid}.x.y`)).toBeNull();
    expect(parseOffer(`${valid}.${toBase64(utf8Encode('http://insecure.example'))}`)).toBeNull();
    const pair = newBoxKeyPair();
    expect(parseOffer(`${OFFER_PREFIX}${toBase64(pair.publicKey)}`)).toBeNull();
  });
});

describe('liens', () => {
  it('se découpent en identifiant et fragment', () => {
    const { id, fragment } = message();
    expect(splitShareLink(`https://notes.example.org/s/${id}#${fragment}`)).toEqual({ id, fragment });
    expect(splitShareLink(`securenotes://s/${id}#${fragment}`)).toEqual({ id, fragment });
    expect(splitShareLink(`https://notes.example.org/s/${id}`)).toBeNull();
  });
});

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  }) as unknown as Response;

describe('relève', () => {
  const instance = { url: 'https://abc.supabase.co', anonKey: 'anon' };

  it('demande le canal à take_handoff, sans compte', async () => {
    const fetchImpl = jest.fn(async () => reply(200, 'chiffré'));
    expect(await takeHandoff(instance, 'canal', fetchImpl as unknown as typeof fetch)).toBe('chiffré');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://abc.supabase.co/rest/v1/rpc/take_handoff');
    expect(JSON.parse(init.body as string)).toEqual({ handoff_id: 'canal' });
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('répond null tant que rien n’est déposé', async () => {
    const fetchImpl = async () => reply(200, null);
    expect(await takeHandoff(instance, 'canal', fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it('refuse une réponse démesurée ou une instance pas à jour', async () => {
    const huge = async () => reply(200, 'x', { 'content-length': '100000' });
    await expect(takeHandoff(instance, 'c', huge as unknown as typeof fetch)).rejects.toThrow(
      HandoffError,
    );
    const long = async () => reply(200, 'x'.repeat(5000));
    await expect(takeHandoff(instance, 'c', long as unknown as typeof fetch)).rejects.toThrow(
      HandoffError,
    );
    const outdated = async () => reply(404, { message: 'not found' });
    await expect(takeHandoff(instance, 'c', outdated as unknown as typeof fetch)).rejects.toThrow(
      /pas à jour/,
    );
  });
});

describe('dépôt', () => {
  const session = reply(200, { access_token: 't', expires_in: 3600, user: { id: 'u' } });
  const profile = reply(200, [{ closed_at: null }]);

  const remoteWith = (answer: Response) => {
    const calls: [string, RequestInit][] = [];
    const answers = [session, profile, answer];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return answers.shift()!;
    };
    const remote = new SupabaseRemote(
      { url: 'https://abc.supabase.co', anonKey: 'anon' },
      { email: 'e', password: 'p' },
      fetchImpl as unknown as typeof fetch,
    );
    return { remote, calls };
  };

  it('écrit dans handoffs avec la session du compte', async () => {
    const { remote, calls } = remoteWith(reply(201, undefined));
    await remote.createHandoff('canal', 'chiffré');
    const [url, init] = calls[2];
    expect(url).toBe('https://abc.supabase.co/rest/v1/handoffs');
    expect(JSON.parse(init.body as string)).toEqual({ id: 'canal', payload: 'chiffré' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('signale un QR code déjà servi ou trop de dépôts', async () => {
    await expect(remoteWith(reply(409, {})).remote.createHandoff('c', 'p')).rejects.toThrow(
      /déjà servi/,
    );
    await expect(
      remoteWith(reply(400, { message: 'handoff_limit' })).remote.createHandoff('c', 'p'),
    ).rejects.toThrow(SyncError);
  });
});
