import { Repeat, Show } from 'meemaw';
import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { useOffline } from '@app/app/app.provider';
import { Check, ImageIcon, RefreshCw } from '@icons';
import { ROUTES } from '@shared/constants/routes';
import type { LocalPhoto } from '@shared/db/fieldkit-db';
import { getPhoto, retryNow } from '@shared/offline';
import { Badge } from '@ui/badge';
import { Button } from '@ui/button';
import { Card, CardTitle } from '@ui/card';
import { Field } from '@ui/field';
import { formatBytes, formatDateTime } from '@ui/format';
import { InlineError } from '@ui/inline-error';
import { Page } from '@ui/page';

import { intentLabel, reasonLabel } from '@features/sync-status/labels';

import { useLocalVisit } from './use-visits';
import type { Visit } from './visits.api';
import { intentsFor, keepMine, takeTheirs, updateVisitLocally, visitSyncState } from './visits.repo';

function LocalPhotoThumb({ photo }: Readonly<{ photo: LocalPhoto }>) {
  const { db } = useOffline();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    void getPhoto(db, photo.id).then((blob) => {
      if (blob) {
        u = URL.createObjectURL(blob);
        setUrl(u);
      }
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [db, photo.id]);
  return (
    <li className="overflow-hidden rounded-[var(--radius-md)] border-2 border-ink bg-white">
      <Show when={url !== null} fallback={<div className="flex aspect-[4/3] items-center justify-center text-ink-muted"><ImageIcon className="size-6" /></div>}>
        <img src={url ?? ''} alt="" className="aspect-[4/3] w-full object-cover" />
      </Show>
      <div className="flex items-center justify-between px-2 py-1.5 text-[11px] text-ink-soft">
        <span>
          {formatBytes(photo.bytes)} · {photo.width}×{photo.height}
        </span>
        <Show when={photo.uploaded_at !== null} fallback={<Badge tone="warning">on this phone</Badge>}>
          <Badge tone="success" icon={<Check className="size-3" />}>
            uploaded
          </Badge>
        </Show>
      </div>
    </li>
  );
}

export function VisitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { db, offline } = useOffline();
  const { visit, photos, records } = useLocalVisit(id);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!id) return null;
  const intents = intentsFor(id, records);
  const state = visitSyncState(intents);
  const conflict = intents.update?.status === 'conflicted' ? (intents.update.conflict as Visit | undefined) : undefined;
  const failed = [intents.create, intents.update, ...intents.photos].filter((r) => r?.status === 'failed');

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!visit) return;
    const patch = {
      ...(ownerName !== null && ownerName.trim() !== visit.owner_name && { owner_name: ownerName.trim() }),
      ...(phone !== null && phone.trim() !== visit.phone && { phone: phone.trim() }),
    };
    if (Object.keys(patch).length === 0) return;
    if ('phone' in patch && (patch.phone ?? '').replace(/\D/g, '').length < 7) {
      setSaveError('Enter a phone number with at least 7 digits.');
      return;
    }
    setSaveError(null);
    try {
      await updateVisitLocally(db, visit.id, patch);
      setSaved(true);
      setOwnerName(null);
      setPhone(null);
      void offline.sync.drain();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save.');
    }
  }

  return (
    <Page title={visit?.shop_name ?? 'Visit'} back={ROUTES.visits}>
      <Show when={visit !== undefined} fallback={<p className="text-ink-muted">This visit is not on this device.</p>}>
        <Card className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <CardTitle>Visit</CardTitle>
            <Badge tone={state === 'synced' ? 'success' : state === 'pending' ? 'warning' : 'danger'} data-testid="visit-state">
              {state === 'synced' ? 'Synced' : state === 'pending' ? 'Waiting to send' : state === 'failed' ? 'Needs attention' : 'Conflict'}
            </Badge>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-muted">Owner</dt>
            <dd className="text-ink">{visit?.owner_name}</dd>
            <dt className="text-ink-muted">Phone</dt>
            <dd className="text-ink">{visit?.phone}</dd>
            <dt className="text-ink-muted">Captured</dt>
            <dd className="text-ink">{visit ? formatDateTime(visit.captured_at) : ''}</dd>
            <dt className="text-ink-muted">Location</dt>
            <dd className="text-ink">{visit?.lat !== null && visit?.lat !== undefined ? `${visit.lat}, ${visit.lng}` : 'not recorded'}</dd>
          </dl>
        </Card>

        <Show when={conflict !== undefined}>
          <Card className="flex flex-col gap-3 border-red" data-testid="conflict-panel">
            <CardTitle className="text-red">Someone else changed this visit</CardTitle>
            <p className="text-sm text-ink-soft">
              Someone else changed this visit while you were editing. Choose which copy to keep.
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-[var(--radius-md)] bg-surface-2 p-3">
                <p className="mb-1 text-xs font-semibold text-ink-muted uppercase">Mine</p>
                <p>{visit?.owner_name}</p>
                <p>{visit?.phone}</p>
              </div>
              <div className="rounded-[var(--radius-md)] bg-surface-2 p-3">
                <p className="mb-1 text-xs font-semibold text-ink-muted uppercase">Theirs</p>
                <p>{conflict?.owner_name}</p>
                <p>{conflict?.phone}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={async () => {
                  if (conflict) await keepMine(db, id, conflict.version);
                  void offline.sync.drain();
                }}
              >
                Keep mine
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={async () => {
                  if (conflict) await takeTheirs(db, id, conflict);
                }}
              >
                Take theirs
              </Button>
            </div>
          </Card>
        </Show>

        <Show when={failed.length > 0}>
          <Card className="flex flex-col gap-2 border-red">
            <CardTitle className="text-red">Could not send</CardTitle>
            <Repeat each={failed}>
              {(r) =>
                r ? (
                  <div key={r.id} className="flex items-center justify-between text-sm">
                    <span className="text-ink-soft">
                      {intentLabel(r.type)} · {reasonLabel(r.lastReason)}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<RefreshCw className="size-3.5" aria-hidden />}
                      onClick={async () => {
                        await retryNow(db, r.id);
                        void offline.sync.drain();
                      }}
                    >
                      Retry
                    </Button>
                  </div>
                ) : null
              }
            </Repeat>
          </Card>
        </Show>

        <Card className="flex flex-col gap-3">
          <CardTitle>Photos</CardTitle>
          <Show when={photos.length > 0} fallback={<p className="text-sm text-ink-muted">No photos were taken for this visit.</p>}>
            <ul className="grid grid-cols-2 gap-2">
              <Repeat each={photos}>{(p) => <LocalPhotoThumb key={p.id} photo={p} />}</Repeat>
            </ul>
          </Show>
        </Card>

        <Card>
          <form onSubmit={(e) => void onSave(e)} className="flex flex-col gap-3">
            <CardTitle>Edit</CardTitle>
            <Field label="Owner name" name="owner_name" value={ownerName ?? visit?.owner_name ?? ''} onChange={(e) => setOwnerName(e.target.value)} />
            <Field label="Owner phone" name="phone" type="tel" value={phone ?? visit?.phone ?? ''} onChange={(e) => setPhone(e.target.value)} />
            <InlineError message={saveError} />
            <Show when={saved}>
              <p className="text-sm text-green">Saved. It will send when there is signal.</p>
            </Show>
            <Button type="submit" variant="secondary" disabled={ownerName === null && phone === null}>
              Save changes
            </Button>
          </form>
        </Card>
      </Show>
    </Page>
  );
}
