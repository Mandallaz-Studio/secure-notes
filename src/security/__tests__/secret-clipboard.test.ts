import * as Clipboard from 'expo-clipboard';
import { AppState } from 'react-native';

import {
  clearClipboardIfContains,
  copySecret,
  SECRET_CLIPBOARD_SECONDS,
} from '@/security/secret-clipboard';

let mockContent = '';

jest.mock('expo-clipboard', () => ({
  getStringAsync: jest.fn(async () => mockContent),
  setStringAsync: jest.fn(async (text: string) => {
    mockContent = text;
    return true;
  }),
}));

const setString = Clipboard.setStringAsync as jest.Mock;
let appStateListener: (state: string) => void = () => {};

/** Laisse s'exécuter les promesses en attente. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const elapse = async (seconds: number) => {
  jest.advanceTimersByTime(seconds * 1000);
  await flush();
};

beforeAll(() => {
  jest.useFakeTimers();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: string) => void;
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
});

beforeEach(() => {
  mockContent = '';
  setString.mockClear();
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
});

describe('copySecret', () => {
  it('copie en marquant le contenu sensible et à durée limitée', async () => {
    await copySecret('phrase secrète');

    expect(mockContent).toBe('phrase secrète');
    const options = setString.mock.calls[0][1];
    expect(options.android).toEqual({ isSensitive: true });
    expect(options.ios.localOnly).toBe(true);
    expect(options.ios.expiresAt.getTime() - Date.now()).toBe(SECRET_CLIPBOARD_SECONDS * 1000);
  });

  it('efface le presse-papiers à l’échéance, pas avant', async () => {
    await copySecret('phrase secrète');

    await elapse(SECRET_CLIPBOARD_SECONDS - 1);
    expect(mockContent).toBe('phrase secrète');

    await elapse(1);
    expect(mockContent).toBe('');
  });

  it('ne touche pas à ce que l’utilisateur a copié entre-temps', async () => {
    await copySecret('phrase secrète');
    mockContent = 'autre chose';

    await elapse(SECRET_CLIPBOARD_SECONDS);
    expect(mockContent).toBe('autre chose');
  });

  it('efface au retour dans l’app si l’échéance est tombée en arrière-plan', async () => {
    await copySecret('phrase secrète');
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });

    await elapse(SECRET_CLIPBOARD_SECONDS + 30);
    expect(mockContent).toBe('phrase secrète');

    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    appStateListener('active');
    await flush();
    expect(mockContent).toBe('');
  });

  it('repart de zéro quand on copie à nouveau', async () => {
    await copySecret('phrase secrète');
    await elapse(SECRET_CLIPBOARD_SECONDS - 10);
    await copySecret('phrase secrète');

    await elapse(SECRET_CLIPBOARD_SECONDS - 10);
    expect(mockContent).toBe('phrase secrète');

    await elapse(10);
    expect(mockContent).toBe('');
  });
});

describe('clearClipboardIfContains', () => {
  it('efface une phrase collée, aux espaces près', async () => {
    mockContent = '  mot1 mot2 mot3\n';
    await clearClipboardIfContains('mot1 mot2 mot3');

    expect(mockContent).toBe('');
  });

  it('laisse un autre contenu intact', async () => {
    mockContent = 'liste de courses';
    await clearClipboardIfContains('mot1 mot2 mot3');

    expect(mockContent).toBe('liste de courses');
  });
});
