import { expect, it } from 'vitest';
import { isContentControl } from '../../../../frontend/src/lib/browserContentInteraction';

it('opens prose while leaving nested links and media controls independent', () => {
  const card = document.createElement('div');
  card.innerHTML = '<p>Entry text</p><div role="button">Open note</div><a href="/app/note/1"><span>Note</span></a><button>Play</button><span role="link">Mention</span><div role="slider">Seek</div>';
  expect(isContentControl({ target: card.querySelector('p'), currentTarget: card })).toBe(false);
  for (const selector of ['a span', 'button', '[role="button"]', '[role="link"]', '[role="slider"]']) {
    expect(isContentControl({ target: card.querySelector(selector), currentTarget: card })).toBe(true);
  }
  card.setAttribute('role', 'button');
  expect(isContentControl({ target: card.querySelector('p'), currentTarget: card })).toBe(false);
  const button = card.querySelector('button')!;
  expect(isContentControl({ target: button, currentTarget: button })).toBe(false);
});
