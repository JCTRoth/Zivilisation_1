import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../i18n/useTranslation';
import { getBrowserSaveStore } from '../../pwa/browserSaveStore';
import { downloadSaveFile, isSaveFileError, pickSaveFile, readSaveFile, saveFileName } from '../../pwa/saveFile';
import type { CampaignMeta } from '@shared/ports/campaignStore';
import '../../styles/pwa.css';

interface CampaignPanelProps {
  /** Load a campaign into the game (starts a new engine when none is running). */
  onLoad: (id: string) => void | Promise<void>;
  /** Save the running game under a name. Absent when no game is running. */
  onSaveCurrent?: (name: string) => void | Promise<void>;
  /** True while a game is running. */
  hasRunningGame?: boolean;
  /** Leave the panel. */
  onBack: () => void;
  /** Report a message to the player. */
  notify?: (message: string, tone?: 'success' | 'error' | 'warning') => void;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '';
  }
}

/**
 * The local campaign library.
 *
 * Every campaign lives in the browser's own storage (IndexedDB, with a
 * localStorage fallback) — so the list is available with or without a
 * network. The same blobs can be exported to a file and imported again on
 * another device.
 */
const CampaignPanel: React.FC<CampaignPanelProps> = ({
  onLoad,
  onSaveCurrent,
  hasRunningGame,
  onBack,
  notify,
}) => {
  const { t } = useTranslation();
  const [campaigns, setCampaigns] = useState<CampaignMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const store = getBrowserSaveStore();
    const list = await store.listCampaigns();
    setCampaigns(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = useCallback(async () => {
    if (!onSaveCurrent) return;
    const trimmed = name.trim();
    try {
      await onSaveCurrent(trimmed);
      setName('');
      notify?.(t('campaigns.saved'), 'success');
      await refresh();
    } catch (error) {
      notify?.(String(error instanceof Error ? error.message : error), 'error');
    }
  }, [name, notify, onSaveCurrent, refresh, t]);

  const handleExport = useCallback(async (campaign: CampaignMeta) => {
    try {
      const store = getBrowserSaveStore();
      const json = await store.readCampaign(campaign.id);
      if (!json) {
        notify?.(t('campaigns.missing'), 'error');
        return;
      }
      downloadSaveFile(json, saveFileName(campaign.turn));
      notify?.(t('campaigns.exported'), 'success');
    } catch (error) {
      notify?.(String(error instanceof Error ? error.message : error), 'error');
    }
  }, [notify, t]);

  const handleDelete = useCallback(async (campaign: CampaignMeta) => {
    try {
      const store = getBrowserSaveStore();
      await store.removeCampaign(campaign.id);
      notify?.(t('campaigns.deleted'), 'success');
      await refresh();
    } catch (error) {
      notify?.(String(error instanceof Error ? error.message : error), 'error');
    }
  }, [notify, refresh, t]);

  const handleImport = useCallback(async () => {
    try {
      const file = await pickSaveFile();
      if (!file) return;
      const result = await readSaveFile(file);
      if (isSaveFileError(result)) {
        notify?.(t('campaigns.invalidFile'), 'error');
        return;
      }
      const store = getBrowserSaveStore();
      const id = `import-${Date.now().toString(36)}`;
      await store.writeCampaign(id, result.json, { kind: 'manual', name: file.name.replace(/\.json$/i, '') });
      notify?.(t('campaigns.imported'), 'success');
      await refresh();
    } catch (error) {
      notify?.(String(error instanceof Error ? error.message : error), 'error');
    }
  }, [notify, refresh, t]);

  return (
    <div className="pwa-panel" role="dialog" aria-modal="true" aria-label={t('campaigns.title')}>
      <div className="pwa-panel__head">
        <h2 className="pwa-panel__title">{t('campaigns.title')}</h2>
        <button type="button" className="pwa-panel__close" onClick={onBack} aria-label={t('common.close')}>
          ✕
        </button>
      </div>

      <p className="pwa-panel__lede">{t('campaigns.lede')}</p>

      {hasRunningGame && onSaveCurrent && (
        <div className="pwa-panel__save">
          <input
            type="text"
            className="pwa-panel__input"
            placeholder={t('campaigns.namePlaceholder')}
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="button" className="pwa-btn pwa-btn--primary" onClick={() => void handleSave()}>
            💾 {t('campaigns.saveCurrent')}
          </button>
        </div>
      )}

      <div className="pwa-panel__toolbar">
        <button type="button" className="pwa-btn" onClick={() => void handleImport()}>
          📂 {t('campaigns.import')}
        </button>
        <button type="button" className="pwa-btn" onClick={() => void refresh()}>
          ⟳ {t('campaigns.refresh')}
        </button>
      </div>

      {loading ? (
        <p className="pwa-panel__empty">{t('campaigns.loading')}</p>
      ) : campaigns.length === 0 ? (
        <p className="pwa-panel__empty">{t('campaigns.empty')}</p>
      ) : (
        <ul className="campaign-list">
          {campaigns.map((campaign) => (
            <li key={campaign.id} className="campaign-list__item">
              <div className="campaign-list__main">
                <strong className="campaign-list__name">{campaign.name}</strong>
                <span className="campaign-list__meta">
                  {t('common.turn', { turn: campaign.turn })}
                  {campaign.civilizationName ? ` · ${campaign.civilizationName}` : ''}
                  {` · ${formatSize(campaign.sizeBytes)}`}
                  {campaign.updatedAt ? ` · ${formatDate(campaign.updatedAt)}` : ''}
                </span>
              </div>
              <div className="campaign-list__actions">
                <button
                  type="button"
                  className="pwa-btn pwa-btn--primary"
                  disabled={busyId === campaign.id}
                  onClick={async () => {
                    setBusyId(campaign.id);
                    try {
                      await onLoad(campaign.id);
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  ▶ {t('campaigns.continue')}
                </button>
                <button type="button" className="pwa-btn" onClick={() => void handleExport(campaign)}>
                  ⬇ {t('campaigns.export')}
                </button>
                <button
                  type="button"
                  className="pwa-btn pwa-btn--danger"
                  onClick={() => void handleDelete(campaign)}
                >
                  🗑 {t('campaigns.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="pwa-panel__foot">
        <button type="button" className="pwa-btn" onClick={onBack}>
          ← {t('campaigns.back')}
        </button>
      </div>
    </div>
  );
};

export default CampaignPanel;
