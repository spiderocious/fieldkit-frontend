import { useQuery } from '@tanstack/react-query';
import { Show } from 'meemaw';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useOffline } from '@app/app/app.provider';
import { MapPin } from '@icons';
import { ROUTES } from '@shared/constants/routes';
import { PHOTO_STOP_RATIO, storageStatus } from '@shared/offline';
import { useSession } from '@shared/session/session';
import { Button } from '@ui/button';
import { Field } from '@ui/field';
import { InlineError } from '@ui/inline-error';
import { Page } from '@ui/page';

import { PhotoPicker, type PickedPhoto } from './photo-picker';
import { createVisitLocally } from './visits.repo';

interface FormErrors {
  shop_name?: string;
  owner_name?: string;
  phone?: string;
}

function validate(f: { shop_name: string; owner_name: string; phone: string }): FormErrors {
  const e: FormErrors = {};
  if (f.shop_name.trim().length === 0) e.shop_name = 'Enter the shop name.';
  if (f.owner_name.trim().length === 0) e.owner_name = 'Enter the owner name.';
  const digits = f.phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 20) e.phone = 'Enter a phone number with 7 to 20 digits.';
  return e;
}

export function NewVisitPage() {
  const navigate = useNavigate();
  const { db, offline } = useOffline();
  const { session } = useSession();
  const [shopName, setShopName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const storage = useQuery({ queryKey: ['storage'], queryFn: storageStatus, staleTime: 10_000 });
  const storageBlocked =
    storage.data && storage.data.quota > 0 && storage.data.ratio >= PHOTO_STOP_RATIO
      ? `This phone is ${Math.round(storage.data.ratio * 100)}% full. Visits still save; photos are paused until your queue has sent.`
      : null;

  function locate() {
    if (!('geolocation' in navigator)) {
      setLocationError('This browser cannot read location.');
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) });
        setLocating(false);
      },
      (err) => {
        setLocationError(err.code === err.PERMISSION_DENIED ? 'Location permission was refused. The visit saves without it.' : 'Could not get a fix. The visit saves without it.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const form = { shop_name: shopName, owner_name: ownerName, phone };
    const next = validate(form);
    setErrors(next);
    if (Object.keys(next).length > 0 || !session) return;
    setSaving(true);
    setSaveError(null);
    const started = performance.now();
    try {
      const visit = await createVisitLocally(db, session.agent.id, {
        shop_name: form.shop_name.trim(),
        owner_name: form.owner_name.trim(),
        phone: form.phone.trim(),
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
        captured_at: new Date().toISOString(),
        photos: photos.map((p) => ({ blob: p.blob, width: p.width, height: p.height })),
      });
      void offline.telemetry.track('visit.saved_locally', { visit_id: visit.id, photos: photos.length, ms: Math.round(performance.now() - started) });
      void offline.sync.drain();
      navigate(ROUTES.visits, { replace: true });
    } catch (err) {
      setSaveError(err instanceof Error ? `Could not save on this device: ${err.message}` : 'Could not save on this device.');
      setSaving(false);
    }
  }

  return (
    <Page title="New visit" back={ROUTES.visits}>
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5" noValidate>
        <Field label="Shop name" name="shop_name" value={shopName} onChange={(e) => setShopName(e.target.value)} error={errors.shop_name} autoFocus />
        <Field label="Owner name" name="owner_name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} error={errors.owner_name} />
        <Field label="Owner phone" name="phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} />

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink">Location</span>
          <div className="flex items-center gap-3">
            <Button type="button" variant="secondary" icon={<MapPin className="size-4" aria-hidden />} loading={locating} onClick={locate}>
              {location ? 'Update location' : 'Use my location'}
            </Button>
            <Show when={location !== null}>
              <span className="text-sm text-ink-soft" data-testid="location">
                {location?.lat}, {location?.lng}
              </span>
            </Show>
          </div>
          <InlineError message={locationError} />
        </div>

        <PhotoPicker photos={photos} onChange={setPhotos} blockedReason={storageBlocked} />

        <InlineError message={saveError} />
        <Button type="submit" size="lg" loading={saving} className="mt-2">
          Save visit
        </Button>
        <p className="text-center text-xs text-ink-muted">Saves on this phone first and sends when there is signal.</p>
      </form>
    </Page>
  );
}
