import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { ApiError } from '@shared/api/client';
import { ROUTES } from '@shared/constants/routes';
import { saveSession, useSession } from '@shared/session/session';
import { Button } from '@ui/button';
import { Field } from '@ui/field';
import { InlineError } from '@ui/inline-error';

import { login } from './auth.api';

export function LoginPage() {
  const navigate = useNavigate();
  const { session, ready } = useSession();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: async (res) => {
      await saveSession({ token: res.token, agent: res.agent });
      navigate(ROUTES.visits, { replace: true });
    },
  });

  if (ready && session) return <Navigate to={ROUTES.visits} replace />;

  const err = mutation.error instanceof ApiError ? mutation.error : null;
  const fieldError = (name: string) => err?.fieldErrors[name]?.[0];
  const topError = err && Object.keys(err.fieldErrors).length === 0 ? err.message : null;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate({ phone: phone.trim(), pin });
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-6 py-10">
      <div className="mb-8">
        <div className="mb-4 flex size-12 items-center justify-center rounded-[var(--radius-md)] border-2 border-ink bg-brand text-xl font-bold text-white">F</div>
        <h1 className="text-2xl font-semibold text-ink">Fieldkit</h1>
        <p className="mt-1 text-ink-soft">Sign in once. The app keeps working when the signal does not.</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          label="Phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="username"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={fieldError('phone')}
          placeholder="0803 000 0001"
        />
        <Field
          label="PIN"
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          error={fieldError('pin')}
        />
        <InlineError message={topError} />
        <Button type="submit" size="lg" loading={mutation.isPending} className="mt-2">
          Sign in
        </Button>
      </form>
      <p className="mt-8 text-center text-xs text-ink-muted">Demo agents: 08030000001, 08030000002, 08030000003. PIN 1234.</p>
    </div>
  );
}
