// Picks photos from the camera or gallery, compresses each one in a worker
// and shows what the compression did. Nothing here touches the network.
import { Repeat, Show } from 'meemaw';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';

import { Camera, Trash2 } from '@icons';
import { compressImage, type CompressedImage } from '@shared/offline';
import { Button } from '@ui/button';
import { formatBytes } from '@ui/format';
import { InlineError } from '@ui/inline-error';

export interface PickedPhoto extends CompressedImage {
  localId: string;
  originalBytes: number;
  url: string;
}

interface Props {
  photos: PickedPhoto[];
  onChange: (photos: PickedPhoto[]) => void;
  /** Set when storage is near its ceiling; the picker refuses new photos. */
  blockedReason?: string | null;
  max?: number;
}

export function PhotoPicker({ photos, onChange, blockedReason, max = 4 }: Readonly<Props>) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Object URLs are released when the photo leaves the list or the page unmounts.
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), [photos]);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const next = [...photos];
      for (const file of files.slice(0, max - photos.length)) {
        const out = await compressImage(file);
        next.push({ ...out, localId: crypto.randomUUID(), originalBytes: file.size, url: URL.createObjectURL(out.blob) });
      }
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? `Could not process that photo: ${err.message}` : 'Could not process that photo.');
    } finally {
      setBusy(false);
    }
  }

  function remove(localId: string) {
    const p = photos.find((x) => x.localId === localId);
    if (p) URL.revokeObjectURL(p.url);
    onChange(photos.filter((x) => x.localId !== localId));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">Photos</span>
        <span className="text-xs text-ink-muted">
          {photos.length}/{max}
        </span>
      </div>
      <Show when={photos.length > 0}>
        <ul className="grid grid-cols-2 gap-2">
          <Repeat each={photos}>
            {(p) => (
              <li key={p.localId} className="relative overflow-hidden rounded-[var(--radius-md)] border-2 border-ink bg-white">
                <img src={p.url} alt="" className="aspect-[4/3] w-full object-cover" />
                <div className="flex items-center justify-between px-2 py-1.5 text-[11px] text-ink-soft">
                  <span>
                    {formatBytes(p.bytes)} · ready
                  </span>
                  <button type="button" onClick={() => remove(p.localId)} aria-label="Remove photo" className="rounded p-1 text-ink-muted hover:text-red">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            )}
          </Repeat>
        </ul>
      </Show>
      <InlineError message={blockedReason ?? error} />
      <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void onPick(e)} />
      <Button
        variant="secondary"
        icon={<Camera className="size-4" aria-hidden />}
        loading={busy}
        disabled={Boolean(blockedReason) || photos.length >= max}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Preparing photo' : 'Add photo'}
      </Button>
    </div>
  );
}
