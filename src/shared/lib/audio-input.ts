let input: { cancel: () => void } | null = null;

export function claimAudioInput(cancel: () => void): (() => void) | null {
  if (input) return null;
  const owner = { cancel };
  input = owner;
  return () => { if (input === owner) input = null; };
}

export function cancelAudioInput(): void { input?.cancel(); }
