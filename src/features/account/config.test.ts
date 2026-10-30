import { describe, expect, it } from 'vitest';
import { accountApiBase } from './config';

const web = { hostname: 'localhost', protocol: 'http:', port: '4173' };
describe('API routing for local previews', () => {
  it('uses the Vite proxy on loopback web origins', () => {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
      expect(accountApiBase('https://api.example.test/', { ...web, hostname }, false)).toBe('/__dayenglish_api/https%3A%2F%2Fapi.example.test');
    }
  });
  it('keeps the configured API in the native localhost shell', () => {
    expect(accountApiBase('https://api.example.test/', web, true)).toBe('https://api.example.test');
    expect(accountApiBase('https://api.example.test', { ...web, port: '' }, false)).toBe('https://api.example.test');
    expect(accountApiBase('https://api.example.test', { ...web, protocol: 'capacitor:' }, true)).toBe('https://api.example.test');
  });
  it('does not route production or unconfigured accounts through a development server', () => {
    expect(accountApiBase('https://api.example.test', { ...web, hostname: 'dayenglish.ru' }, false)).toBe('https://api.example.test');
    expect(accountApiBase('', web, false)).toBe('');
    expect(accountApiBase('/api', web, false)).toBe('/api');
    expect(accountApiBase('https://api.example.test', undefined, false)).toBe('https://api.example.test');
  });
});
