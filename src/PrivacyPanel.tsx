import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Trash2, X } from 'lucide-react';
import { studioRequest } from './studioApi';
import { apiSession } from './apiSession';
export const legalVersion = '2026-11-16';
export function PrivacyPanel() {
  const [preview, setPreview] = useState<{
      canDelete: boolean;
      mergedStudios: number;
      counts: Record<string, number>;
    } | null>(null),
    [error, setError] = useState(''),
    [open, setOpen] = useState(false),
    [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true;
    studioRequest<typeof preview>('privacy')
      .then(v => {
        if (!v || typeof v.canDelete !== 'boolean' || !v.counts) throw Error('Invalid privacy response');
        if (active) setPreview(v);
      })
      .catch(() => {
        if (active) setError('Atualize a API da VPS para gerenciar a exclusão dos dados.');
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  async function erase() {
    if (confirmation !== 'EXCLUIR' || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await studioRequest<{ message: string }>('privacy', { method: 'DELETE', body: { confirmation } });
      try {
        localStorage.removeItem('serial-platform:' + apiSession.workspaceId);
      } catch {}
      dispatchEvent(new CustomEvent('serial-session-ended', { detail: { message: result.message } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel privacy-panel">
      <div className="section-head">
        <div>
          <h2>
            <ShieldCheck size={18} />
            Privacidade e dados
          </h2>
          <p>Excluir seus dados da Dashboard não apaga conteúdo nas plataformas.</p>
        </div>
        <button
          className="danger-button"
          disabled={!preview?.canDelete}
          onClick={() => {
            setOpen(true);
            setConfirmation('');
          }}
        >
          <Trash2 size={15} />
          Excluir meu estúdio
        </button>
      </div>
      {error && !open && (
        <p role="status" className="api-note">
          {error}
        </p>
      )}
      {preview && !preview.canDelete && (
        <p className="footnote">A exclusão do estúdio exige login por uma conta pessoal.</p>
      )}
      <p className="footnote">
        A exclusão abrange todos os canais deste estúdio, incluindo contas unidas. Backups da hospedagem têm prazo
        operacional de até sete dias. Contato:{' '}
        <a href="mailto:contato.serialhealer@gmail.com">contato.serialhealer@gmail.com</a>.
      </p>
      <dialog
        ref={dialog}
        className="privacy-dialog"
        onCancel={e => {
          if (busy) e.preventDefault();
          else setOpen(false);
        }}
        onClose={() => setOpen(false)}
      >
        <header>
          <h2>Excluir seu estúdio?</h2>
          <button className="icon" aria-label="Fechar exclusão" disabled={busy} onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </header>
        <p>
          Serão removidos os dados ativos dos {preview?.counts.channels ?? 0} canais, relatórios, comentários
          importados, planos e registros financeiros deste estúdio.{' '}
          {preview?.mergedStudios ? `Isso inclui ${preview.mergedStudios} estúdio(s) unido(s).` : ''}
        </p>
        <p>
          As sessões serão encerradas e a revogação será solicitada às plataformas. Se estiverem indisponíveis, as
          credenciais criptografadas usadas só para novas tentativas serão descartadas em até sete dias. Vídeos e contas
          nas plataformas permanecem.
        </p>
        <label>
          Digite EXCLUIR para confirmar
          <input
            autoComplete="off"
            value={confirmation}
            onChange={e => setConfirmation(e.target.value)}
            disabled={busy}
          />
        </label>
        {error && (
          <p role="alert" className="api-error">
            {error}
          </p>
        )}
        <footer>
          <button disabled={busy} onClick={() => setOpen(false)}>
            Cancelar
          </button>
          <button className="danger-button" disabled={confirmation !== 'EXCLUIR' || busy} onClick={() => void erase()}>
            {busy ? 'Excluindo…' : 'Excluir dados e encerrar sessões'}
          </button>
        </footer>
      </dialog>
    </section>
  );
}
