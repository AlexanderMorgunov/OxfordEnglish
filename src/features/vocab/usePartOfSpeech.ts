import { useEffect, useState } from 'react';
import { isPartOfSpeech } from './grammar-metadata';
import type { PosData } from './grammar-metadata';

const EMPTY: PosData = new Map();
let dataPromise: Promise<PosData> | null = null;

export function indexPartsOfSpeech(value: unknown): PosData {
  const data: PosData = new Map();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return data;
  for (const [word, readings] of Object.entries(value)) {
    if (Array.isArray(readings)) {
      const valid = [...new Set(readings.filter(isPartOfSpeech))];
      if (valid.length) data.set(word.toLowerCase(), valid);
    }
  }
  return data;
}

export function usePartOfSpeech(): PosData {
  const [data, setData] = useState<PosData>(EMPTY);
  useEffect(() => {
    let alive = true;
    dataPromise ??= fetch(`${import.meta.env.BASE_URL}reader/en-pos.json`)
      .then(response => response.ok ? response.json() : null)
      .then((json: unknown) => indexPartsOfSpeech(json && typeof json === 'object' && 'partsOfSpeech' in json ? json.partsOfSpeech : null))
      .catch(() => EMPTY);
    void dataPromise.then(value => { if (alive) setData(value); });
    return () => { alive = false; };
  }, []);
  return data;
}
