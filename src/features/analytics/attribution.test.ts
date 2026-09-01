import { test, expect, beforeEach, afterEach } from 'vitest';
import { captureAttribution, getAttribution } from './attribution';
import { setAnalyticsEnabled } from './analytics';

function setReferrer(value: string) {
  Object.defineProperty(document, 'referrer', { configurable: true, get: () => value });
}

beforeEach(() => {
  localStorage.clear();
  setAnalyticsEnabled(true);
  setReferrer('');
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  setReferrer('');
});

test('captures utm first-touch and never overwrites it', () => {
  window.history.pushState({}, '', '/?utm_source=vk&utm_medium=social&utm_campaign=launch');
  captureAttribution();
  const first = getAttribution();
  expect(first).toMatchObject({ source: 'vk', medium: 'social', campaign: 'launch', landing: '/' });
  expect(typeof first?.ts).toBe('number');

  // A later campaign must NOT overwrite the original first touch.
  window.history.pushState({}, '', '/?utm_source=google&utm_medium=cpc');
  captureAttribution();
  expect(getAttribution()?.source).toBe('vk');
});

test('stores the referrer hostname only, never the full URL', () => {
  setReferrer('https://yandex.ru/search?q=secret+query');
  captureAttribution();
  const attr = getAttribution();
  expect(attr?.referrer).toBe('yandex.ru');
  expect(JSON.stringify(attr)).not.toContain('secret');
});

test('records nothing for a plain direct visit (no utm, no external referrer)', () => {
  captureAttribution();
  expect(getAttribution()).toBeNull();
});

test('respects opt-out — captures nothing when analytics is disabled', () => {
  setAnalyticsEnabled(false);
  window.history.pushState({}, '', '/?utm_source=vk');
  captureAttribution();
  expect(getAttribution()).toBeNull();
});
