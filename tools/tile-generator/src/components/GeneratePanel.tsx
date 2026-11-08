import { useState, useEffect, useRef } from 'react';
import * as api from '../api';
import { TERRAIN_PRESETS, FEATURE_PRESETS } from '../presets';
import type { FalModel, TextureGroup } from '../types';
import './GeneratePanel.css';

const DEFAULT_MODEL = 'flux-2-klein-4b';
const QUICK_MODEL_IDS = ['flux-2-klein-4b'];
// Local Stable Diffusion server — background removal runs via local Python rembg.
const BG_MODELS = [
  { id: 'local-rembg', label: 'rembg (local)' },
];

interface Props {
  onGenerated: () => void;
  pendingSource?: { path: string; name: string } | null;
  onPendingSourceConsumed?: () => void;
}

export default function GeneratePanel({ onGenerated, pendingSource, onPendingSourceConsumed }: Props) {
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [models, setModels] = useState<FalModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [tileName, setTileName] = useState('');
  const [width, setWidth] = useState(256);
  const [height, setHeight] = useState(256);
  const [steps, setSteps] = useState(4); // sampling iterations (steps)
  const [autoRemoveBg, setAutoRemoveBg] = useState(false);
  const [bgModel, setBgModel] = useState(BG_MODELS[0].id);
  const [variationCount, setVariationCount] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<{ text: string; type: 'idle' | 'ok' | 'error' }>({ text: '', type: 'idle' });
  const [estimate, setEstimate] = useState<string>('—');
  const [activeTerrainPreset, setActiveTerrainPreset] = useState<string | null>(null);
  const [activeFeaturePreset, setActiveFeaturePreset] = useState<string | null>(null);
  // Image-to-image / variation controls
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [strength, setStrength] = useState(0.6);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [textures, setTextures] = useState<TextureGroup[]>([]);
  const [loadingTextures, setLoadingTextures] = useState(false);
  const estimateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch models when picker opens
  useEffect(() => {
    if (!showModelPicker || models.length > 0) return;
    setLoadingModels(true);
    api.fetchModels().then(m => { setModels(m); setLoadingModels(false); }).catch(() => setLoadingModels(false));
  }, [showModelPicker, models.length]);

  // Debounced cost estimate
  useEffect(() => {
    if (estimateTimer.current) clearTimeout(estimateTimer.current);
    estimateTimer.current = setTimeout(async () => {
      try {
        const r = await api.estimateCost(model, width, height);
        if (r.estimatedCost != null) {
          setEstimate(`$${r.estimatedCost.toFixed(4)} ${r.currency ?? 'USD'}`);
        } else {
          setEstimate('—');
        }
      } catch {
        setEstimate('—');
      }
    }, 600);
    return () => { if (estimateTimer.current) clearTimeout(estimateTimer.current); };
  }, [model, width, height]);

  // Consume a "Use as Source" selection from the gallery.
  useEffect(() => {
    if (!pendingSource) return;
    setSourceImage(pendingSource.path);
    setSourceName(pendingSource.name);
    // The source drives img2img — denoising strength is the "Strength" slider.
    setStatus({ text: `Source set: ${pendingSource.name} — will be used for img2img.`, type: 'idle' });
    onPendingSourceConsumed?.();
  }, [pendingSource, onPendingSourceConsumed]);

  function applyTerrainPreset(key: string) {
    const p = TERRAIN_PRESETS[key];
    setPrompt(p.prompt);
    setTileName(p.file);
    setWidth(p.w);
    setHeight(p.h);
    setActiveTerrainPreset(key);
    setActiveFeaturePreset(null);
  }

  function applyFeaturePreset(key: string) {
    const p = FEATURE_PRESETS[key];
    setPrompt(p.prompt);
    setTileName(p.file);
    setWidth(p.w);
    setHeight(p.h);
    setActiveFeaturePreset(key);
    setActiveTerrainPreset(null);
  }

  async function openSourcePicker() {
    setShowSourcePicker(true);
    if (textures.length > 0) return;
    setLoadingTextures(true);
    try {
      const groups = await api.fetchTextures();
      setTextures(groups);
    } catch {
      // ignore; the picker will just show an empty/error state
    } finally {
      setLoadingTextures(false);
    }
  }

  function pickSource(path: string, name: string) {
    setSourceImage(path);
    setSourceName(name);
    setShowSourcePicker(false);
  }

  function clearSource() {
    setSourceImage(null);
    setSourceName('');
  }

  function handleSourceUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSourceImage(String(reader.result));
      setSourceName(file.name);
      // Clear the input value so the same file can be re-picked later.
      e.target.value = '';
    };
    reader.readAsDataURL(file);
  }

  async function handleGenerate() {
    if (!prompt.trim() || !tileName.trim()) {
      setStatus({ text: 'Enter a prompt and tile name.', type: 'error' });
      return;
    }
    setGenerating(true);
    const count = Math.max(1, Math.min(10, variationCount));
    setStatus({ text: `Generating ${count} variation${count > 1 ? 's' : ''}…`, type: 'idle' });
    try {
      const results = [];
      for (let i = 0; i < count; i++) {
        if (count > 1) {
          setStatus({ text: `Generating variation ${i + 1}/${count}…`, type: 'idle' });
        }
        const result = await api.generate({
          model,
          prompt,
          tileName: tileName.trim(),
          width,
          height,
          steps,
          imageUrl: sourceImage,
          strength,
        });
        if (!result.ok) {
          setStatus({ text: result.error ?? 'Generation failed', type: 'error' });
          return;
        }
        if (autoRemoveBg && result.filename) {
          setStatus({ text: `Removing background for variation ${i + 1}…`, type: 'idle' });
          const bgResult = await api.removeBg(result.filename, bgModel);
          if (!bgResult.ok) {
            setStatus({ text: `Generated but bg-remove failed: ${bgResult.error}`, type: 'error' });
            onGenerated();
            return;
          }
        }
        results.push(result.filename);
      }
      setStatus({ text: `Saved ${results.length} variation${results.length > 1 ? 's' : ''}`, type: 'ok' });
      onGenerated();
    } catch (e: unknown) {
      setStatus({ text: String(e), type: 'error' });
    } finally {
      setGenerating(false);
    }
  }

  const filteredModels = models.filter(m =>
    m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
    m.id.toLowerCase().includes(modelSearch.toLowerCase())
  );

  return (
    <aside className="gen-panel">
      <div className="gen-header">
        <h1>🗺️ Tile Generator</h1>
        <p className="gen-subtitle">AI terrain tiles for Civ</p>
      </div>

      {/* Model */}
      <section className="gen-section">
        <h3>Model</h3>
        <div className="model-row">
          <select
            className="field-input"
            value={model}
            onChange={e => setModel(e.target.value)}
          >
            <option value="flux-2-klein-4b">Flux 2 Klein (local) ⚡</option>
            {!QUICK_MODEL_IDS.includes(model) && (
              <option value={model}>{model}</option>
            )}
          </select>
          <button className="btn-secondary" onClick={() => setShowModelPicker(true)}>Browse</button>
        </div>
        <div className="model-meta">
          Est. cost: <span className="cost">{estimate}</span>
        </div>
      </section>

      {/* Terrain presets */}
      <section className="gen-section">
        <h3>Terrain Tiles</h3>
        <div className="preset-grid">
          {Object.entries(TERRAIN_PRESETS).map(([key, p]) => (
            <button
              key={key}
              className={`preset-btn${activeTerrainPreset === key ? ' active' : ''}`}
              onClick={() => applyTerrainPreset(key)}
            >
              <span className="preset-dot" style={{ background: p.color }} />
              {p.name}
            </button>
          ))}
        </div>
      </section>

      {/* Feature presets */}
      <section className="gen-section">
        <h3>Feature Sprites</h3>
        <div className="preset-grid">
          {Object.entries(FEATURE_PRESETS).map(([key, p]) => (
            <button
              key={key}
              className={`preset-btn${activeFeaturePreset === key ? ' active' : ''}`}
              onClick={() => applyFeaturePreset(key)}
            >
              <span className="preset-dot" style={{ background: p.color }} />
              {p.name}
            </button>
          ))}
        </div>
      </section>

      {/* Prompt */}
      <section className="gen-section">
        <h3>Prompt</h3>
        <textarea
          className="field-input prompt-area"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Describe the tile…"
          rows={4}
        />
      </section>

      {/* Size */}
      <section className="gen-section">
        <h3>Size</h3>
        <div className="size-row">
          <label className="size-field">
            <span>W</span>
            <input className="field-input" type="number" value={width} min={64} max={2048} step={64}
              onChange={e => setWidth(Number(e.target.value))} />
          </label>
          <span className="size-sep">×</span>
          <label className="size-field">
            <span>H</span>
            <input className="field-input" type="number" value={height} min={64} max={2048} step={64}
              onChange={e => setHeight(Number(e.target.value))} />
          </label>
        </div>
      </section>

      {/* Iterations (sampling steps) */}
      <section className="gen-section">
        <h3>Iterations (steps)</h3>
        <div className="variation-row">
          <input
            className="field-input"
            type="number"
            value={steps}
            min={1}
            max={50}
            onChange={e => setSteps(Math.max(1, Math.min(50, Number(e.target.value))))}
          />
          <span className="variation-hint">sampling steps — more = higher quality, slower</span>
        </div>
      </section>

      {/* Tile name */}
      <section className="gen-section">
        <h3>Tile Name</h3>
        <input
          className="field-input"
          type="text"
          value={tileName}
          onChange={e => setTileName(e.target.value)}
          placeholder="e.g. terrain_grassland"
        />
        <p className="field-hint">Variants are stored as <code>{tileName || 'name'}_1.png</code>, <code>_2.png</code>, …</p>
      </section>

      {/* Variation count */}
      <section className="gen-section">
        <h3>Variations</h3>
        <div className="variation-row">
          <input
            className="field-input"
            type="number"
            value={variationCount}
            min={1}
            max={10}
            onChange={e => setVariationCount(Number(e.target.value))}
          />
          <span className="variation-hint">Generate multiple variations at once (1-10)</span>
        </div>
      </section>

      {/* Source image (img2img) + strength */}
      <section className="gen-section">
        <h3>Source Image (img2img)</h3>
        {sourceImage ? (
          <div className="source-preview">
            <img src={sourceImage} alt="Source" className="source-thumb" />
            <div className="source-meta">
              <span className="source-name" title={sourceName}>{sourceName || 'source'}</span>
              <button className="btn-secondary" onClick={clearSource}>Clear</button>
            </div>
          </div>
        ) : (
          <p className="source-empty">No source selected — pick or upload one (optional; leave empty for text-to-image).</p>
        )}
        <div className="source-actions">
          <button className="btn-secondary" onClick={openSourcePicker}>Pick texture…</button>
          <label className="btn-secondary source-upload-label">
            Upload…
            <input type="file" accept="image/*" onChange={handleSourceUpload} />
          </label>
        </div>
      </section>

      <section className="gen-section">
        <h3>Strength</h3>
        <div className="strength-row">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={strength}
            onChange={e => setStrength(Number(e.target.value))}
          />
          <span className="strength-value">{strength.toFixed(2)}</span>
        </div>
        <p className="field-hint">Denoising strength for img2img (needs a source image). Higher = more change from the source.</p>
      </section>

      {/* Remove BG */}
      <section className="gen-section">
        <label className="checkbox-row">
          <input type="checkbox" checked={autoRemoveBg} onChange={e => setAutoRemoveBg(e.target.checked)} />
          Remove background after generation
        </label>
        {autoRemoveBg && (
          <select className="field-input" style={{ marginTop: 6 }} value={bgModel} onChange={e => setBgModel(e.target.value)}>
            {BG_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}
      </section>

      {/* Generate */}
      <section className="gen-section">
        <button
          className="btn-generate"
          onClick={handleGenerate}
          disabled={generating || !prompt.trim() || !tileName.trim()}
        >
          {generating ? '⏳ Generating…' : '✨ Generate'}
        </button>
        {status.text && (
          <p className={`gen-status ${status.type}`}>{status.text}</p>
        )}
      </section>

      {/* Model picker dialog */}
      {showModelPicker && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <span>Choose Model</span>
              <button className="modal-close" onClick={() => setShowModelPicker(false)}>✕</button>
            </div>
            <div className="modal-search">
              <input
                className="field-input"
                autoFocus
                placeholder="Search models…"
                value={modelSearch}
                onChange={e => setModelSearch(e.target.value)}
              />
            </div>
            <div className="modal-list">
              {loadingModels && <p className="modal-loading">Loading models…</p>}
              {filteredModels.map(m => (
                <button
                  key={m.id}
                  className={`model-item${model === m.id ? ' active' : ''}`}
                  onClick={() => { setModel(m.id); setShowModelPicker(false); }}
                >
                  <span className="model-item-name">
                    {m.name}
                    {m.isEdit && <span className="model-item-badge">edit</span>}
                  </span>
                  <span className="model-item-id">{m.id}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Source image picker dialog */}
      {showSourcePicker && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <span>Choose Source Texture</span>
              <button className="modal-close" onClick={() => setShowSourcePicker(false)}>✕</button>
            </div>
            <div className="modal-list">
              {loadingTextures && <p className="modal-loading">Loading textures…</p>}
              {!loadingTextures && textures.length === 0 && (
                <p className="modal-loading">No textures found. Generate some first, or upload a file.</p>
              )}
              {textures.map(group => (
                <div key={group.name} className="source-group">
                  <div className="source-group-title">{group.name}</div>
                  {group.variants.map(v => (
                    <button
                      key={v.filename}
                      className="source-item"
                      onClick={() => pickSource(v.path, v.filename)}
                    >
                      <img src={v.path} alt={v.filename} loading="lazy" />
                      <span>{v.filename}</span>
                    </button>
                  ))}
                  {group.inGameTiles.map(t => (
                    <button
                      key={t.filename}
                      className="source-item"
                      onClick={() => pickSource(t.path, t.filename)}
                    >
                      <img src={t.path} alt={t.filename} loading="lazy" />
                      <span>{t.filename} <em>in game</em></span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
