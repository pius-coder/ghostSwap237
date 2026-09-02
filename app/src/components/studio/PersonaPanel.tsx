// PersonaPanel — left column of the Studio (adapted from fxswap37).
// A persona = portrait + prompt. Selecting one while live restarts the session.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Trash2 } from 'lucide-react';
import { AppButton, AppSurface, IconButton } from '@/components/app';
import {
  createPersonaFromFile,
  deletePersona,
  loadActivePersonaId,
  loadAllPersonas,
  saveActivePersonaId,
  upsertPersona,
  type Persona,
} from '@/lib/personas';
import { defaultPersonaPrompt } from '@/lib/personaPrompts';
import { restartLiveSession } from '@/lib/session/applyPersona';
import { useSessionCommands } from '@/lib/session/sessionContext';
import { AddPersonaDialog } from './AddPersonaDialog';
import { ConfirmDialog } from './ConfirmDialog';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function PersonaPanel({
  resetNonce,
  sourceStream,
  onActivePersonaChange,
}: {
  resetNonce: number;
  sourceStream?: MediaStream | null;
  onActivePersonaChange: (persona: Persona | null) => void;
}) {
  const { t } = useTranslation();
  const session = useSessionCommands();
  const statusRef = useRef(session.status);

  const fileRef = useRef<HTMLInputElement>(null);

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<
    | { kind: 'select'; persona: Persona }
    | { kind: 'replace'; file: File }
    | null
  >(null);

  const live = session.status !== 'disconnected';
  const activePersona = personas.find((p) => p.id === activeId) ?? null;

  const onChangeRef = useRef(onActivePersonaChange);

  useEffect(() => {
    statusRef.current = session.status;
  }, [session.status]);

  useEffect(() => {
    onChangeRef.current = onActivePersonaChange;
  }, [onActivePersonaChange]);

  useEffect(() => {
    let cancelled = false;
    void loadAllPersonas().then((all) => {
      if (cancelled) return;
      setPersonas(all);
      const stored = loadActivePersonaId();
      const fromStorage = stored ? all.find((p) => p.id === stored) : undefined;
      const initial = fromStorage ?? all[0] ?? null;
      setActiveId(initial?.id ?? null);
      onChangeRef.current(initial);
    });
    return () => {
      cancelled = true;
    };
  }, [resetNonce]);

  useEffect(() => {
    onChangeRef.current(activePersona);
  }, [activePersona]);

  const selectLocally = (persona: Persona) => {
    setActiveId(persona.id);
    saveActivePersonaId(persona.id);
    setError(null);
  };

  const applyLive = async (persona: Persona) => {
    setBusy(true);
    setError(null);
    try {
      await restartLiveSession(session, () => statusRef.current, persona, sourceStream ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const selectPersona = (persona: Persona) => {
    if (persona.id === activeId) return;
    if (live) {
      setPending({ kind: 'select', persona });
      return;
    }
    selectLocally(persona);
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const replaceImage = async (file?: File) => {
    if (!file || !activePersona) return;
    setBusy(true);
    setError(null);
    try {
      const imageUrl = await readFileAsDataUrl(file);
      const updated: Persona = { ...activePersona, imageUrl };
      setPersonas(upsertPersona(updated));
      if (live) {
        await restartLiveSession(session, () => statusRef.current, updated, sourceStream ?? null);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setPending(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const saveNewPersona = async (name: string, file: File) => {
    setBusy(true);
    setError(null);
    try {
      const imageUrl = await readFileAsDataUrl(file);
      const persona = createPersonaFromFile(name, imageUrl);
      upsertPersona(persona);
      const merged = await loadAllPersonas();
      setPersonas(merged.length ? merged : [persona]);
      setAdding(false);
      if (live) {
        setPending({ kind: 'select', persona });
        return;
      }
      selectLocally(persona);
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const removePersona = (persona: Persona) => {
    const all = deletePersona(persona.id);
    void loadAllPersonas().then(setPersonas);
    if (activeId === persona.id) {
      const next = all[0] ?? null;
      setActiveId(next?.id ?? null);
      saveActivePersonaId(next?.id ?? null);
    }
  };

  return (
    <section className="client-persona-panel flex flex-col">
      <header className="flex items-start justify-between gap-2 px-1 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{t('studio.persona')}</p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            {t('studio.personaHint')}
          </p>
        </div>
      </header>

      <div className="min-h-0">
        {activePersona?.imageUrl ? (
          <AppSurface elevated className="client-persona-active mb-4 flex overflow-hidden p-2">
            <img
              src={activePersona.imageUrl}
              alt={activePersona.name}
              className="h-24 w-[76px] shrink-0 rounded-md object-cover"
            />
            <div className="min-w-0 flex-1 px-3 py-1.5">
              <p className="truncate text-sm font-medium leading-tight text-foreground">{activePersona.name}</p>
              <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted-foreground">
                {activePersona.prompt || defaultPersonaPrompt()}
              </p>
              <label className="mt-2 inline-flex cursor-pointer items-center text-[11px] font-medium text-foreground underline-offset-2 hover:underline">
                {t('studio.replacePortrait')}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (live) {
                      setPending({ kind: 'replace', file });
                      return;
                    }
                    void replaceImage(file);
                  }}
                />
              </label>
            </div>
          </AppSurface>
        ) : (
          <p className="mb-4 text-xs text-muted-foreground">
            {t('studio.selectPortrait')}
          </p>
        )}

        <div className="client-persona-library-header mb-2 flex items-center justify-between gap-2 pt-3">
          <p className="text-xs font-medium text-muted-foreground">{t('studio.library')}</p>
          <AppButton
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() => setAdding(true)}
          >
            <Plus className="size-3.5" />
            {t('studio.addPersona')}
          </AppButton>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {personas.map((persona) => {
            const selected = persona.id === activeId;
            return (
              <div key={persona.id} className="group relative min-w-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => selectPersona(persona)}
                  aria-pressed={selected}
                  className={`client-persona-card relative block w-full overflow-hidden text-left transition-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20 ${
                    selected
                      ? 'is-selected'
                      : ''
                  }`}
                >
                  {persona.imageUrl ? (
                    <img src={persona.imageUrl} alt="" className="aspect-square w-full object-cover" />
                  ) : (
                    <span className="flex aspect-square items-center justify-center bg-panel text-muted-foreground">
                      ?
                    </span>
                  )}
                  <span className="block truncate px-2 py-1.5 text-[11px] font-medium text-foreground">
                    {persona.name}
                  </span>
                  {selected ? (
                    <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
                      <Check className="size-3" />
                    </span>
                  ) : null}
                </button>
                {selected ? (
                  <AppButton
                    variant="danger"
                    size="icon"
                    disabled={busy}
                    onClick={() => removePersona(persona)}
                    aria-label={t('studio.delete')}
                    title={t('studio.delete')}
                    className="absolute bottom-7 right-1.5 size-7 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </AppButton>
                ) : null}
              </div>
            );
          })}
        </div>

        {!personas.length && !adding && (
          <p className="mt-2 text-xs leading-snug text-muted-foreground">
            {t('studio.noPersonaYet')}
          </p>
        )}

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>

      <AddPersonaDialog
        open={adding}
        busy={busy}
        onClose={() => {
          if (!busy) setAdding(false);
        }}
        onSave={saveNewPersona}
      />

      <ConfirmDialog
        open={Boolean(pending)}
        title={
          pending?.kind === 'replace'
            ? t('studio.replacePortraitTitle')
            : pending
              ? t('studio.switchToPersona', { name: pending.persona.name })
              : t('studio.switchPersona')
        }
        body={t('studio.restartBody')}
        confirmLabel={t('studio.restartSession')}
        busy={busy}
        onClose={() => {
          if (!busy) setPending(null);
        }}
        onConfirm={() => {
          if (!pending) return;
          if (pending.kind === 'replace') {
            void replaceImage(pending.file).then(() => setPending(null));
            return;
          }
          selectLocally(pending.persona);
          void applyLive(pending.persona);
        }}
      />
    </section>
  );
}
