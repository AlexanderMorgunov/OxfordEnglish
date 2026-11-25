import { expect, test } from 'vitest';
import { GameManifestSchema as client } from './contract';
import { GameManifestSchema as server } from '../../../server/src/games';
import lumi from '../../../examples/lumi-catalog.json';
const fixture = lumi[0]!;

test('catalogue presentation has matching server/client contracts', () => {
  expect(client.parse(lumi[0])).toEqual(server.parse(lumi[0]));
  const legacy = { ...lumi[0], presentation: undefined };
  expect(client.parse(legacy)).toEqual(server.parse(legacy));
});
test('unreviewed artwork and unbounded metadata are rejected on both sides', () => {
  for (const schema of [client, server]) {
    expect(
      schema.safeParse({
        ...fixture,
        presentation: {
          ...fixture.presentation,
          artwork: 'https://tracker.example/pixel',
        },
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        ...fixture,
        presentation: { ...fixture.presentation, description: 'a'.repeat(601) },
      }).success
    ).toBe(false);
    expect(schema.safeParse({ ...fixture, gameId: 'Submit' }).success).toBe(
      false
    );
  }
});
