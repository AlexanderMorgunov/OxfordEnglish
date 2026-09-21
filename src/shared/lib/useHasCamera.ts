import { useEffect, useState } from 'react';

/**
 * Whether this device has a camera at all — `null` until we know.
 *
 * Offering "scan a QR" on a desktop without one is the whole reason device linking felt broken: the
 * code is shown on the phone being added, and the machine that has to read it is often the one with
 * no camera. The typed-code path was always there; the scan button just made it look like the wrong
 * one was intended.
 *
 * Reads the device list rather than asking for the camera: `enumerateDevices` reports a `videoinput`
 * entry before any permission is granted (with the label blanked), so this costs no prompt. Absent
 * `mediaDevices` — an insecure origin, an old WebView — means no scanning either way.
 */
export function useHasCamera(): boolean | null {
  const [has, setHas] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) {
      setHas(false);
      return;
    }
    void media
      .enumerateDevices()
      .then((devices) => {
        if (alive) setHas(devices.some((d) => d.kind === 'videoinput'));
      })
      .catch(() => {
        // Refused or unsupported: treat as absent rather than offer a button that cannot work.
        if (alive) setHas(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return has;
}
