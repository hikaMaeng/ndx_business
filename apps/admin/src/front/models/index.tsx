import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Boxes, Plus, RefreshCw, Save, X } from "lucide-react";
import { ensureModelsFeatureModel } from "admin_domain/front";
import {
  parseModelCatalogSnapshot,
  type CreateModelEndpointRequest,
  type ModelDefinition,
  type ModelEndpoint,
  type ModelEndpointType,
  type UpdateModelDefinitionRequest,
} from "admin_domain/common";
import { Button } from "../components/ui/button";
import { resolveLanguage, texts } from "../i18n";
import { useModel } from "../model/useModel";
import { RSC } from "./resource";
import type { ModelsRequestApi } from "./types";
import "./styles.css";

export type { ModelsRequestApi } from "./types";

type EndpointDraft = CreateModelEndpointRequest;
type EndpointSave = { (draft: EndpointDraft): Promise<void> };
type ModelDefinitionSave = {
  (endpointId: string, modelId: string, draft: UpdateModelDefinitionRequest): Promise<void>;
};

const endpointTypes: Array<[ModelEndpointType, RSC]> = [
  ["openai-chat-completion", RSC.MODELS_TYPE_OPENAI_CHAT_COMPLETION_LABEL],
  ["openai-responses", RSC.MODELS_TYPE_OPENAI_RESPONSES_LABEL],
  ["anthropic", RSC.MODELS_TYPE_ANTHROPIC_LABEL],
  ["gemini", RSC.MODELS_TYPE_GEMINI_LABEL],
];

function createEndpointDraft(endpoint?: ModelEndpoint): EndpointDraft {
  return endpoint
    ? {
        name: endpoint.name,
        url: endpoint.url,
        headerName: endpoint.headerName,
        headerValue: endpoint.headerValue,
        type: endpoint.type,
      }
    : {
        name: "",
        url: "",
        headerName: "",
        headerValue: "",
        type: "openai-chat-completion",
      };
}

function providerLabel(type: ModelEndpointType, text: Record<string, string>): string {
  return text[endpointTypes.find(([value]) => value === type)![1]];
}

function EndpointForm({
  endpoint,
  busy,
  error,
  text,
  onSave,
  onCancel,
}: {
  endpoint?: ModelEndpoint;
  busy: boolean;
  error?: string;
  text: Record<string, string>;
  onSave: EndpointSave;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => createEndpointDraft(endpoint));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await onSave(draft);
  }

  return (
    <form className="models-endpoint-form" onSubmit={submit}>
      <label>
        {text[RSC.MODELS_ENDPOINT_NAME_LABEL]}
        <input
          required
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </label>
      <label>
        {text[RSC.MODELS_ENDPOINT_URL_LABEL]}
        <input
          required
          type="url"
          value={draft.url}
          placeholder={text[RSC.MODELS_ENDPOINT_URL_PLACEHOLDER]}
          onChange={(event) => setDraft({ ...draft, url: event.target.value })}
        />
      </label>
      <div className="models-endpoint-form-grid">
        <label>
          {text[RSC.MODELS_ENDPOINT_HEADER_NAME_LABEL]}
          <input
            value={draft.headerName}
            onChange={(event) => setDraft({ ...draft, headerName: event.target.value })}
          />
        </label>
        <label>
          {text[RSC.MODELS_ENDPOINT_HEADER_VALUE_LABEL]}
          <input
            value={draft.headerValue}
            placeholder={text[RSC.MODELS_ENDPOINT_HEADER_VALUE_PLACEHOLDER]}
            onChange={(event) => setDraft({ ...draft, headerValue: event.target.value })}
          />
        </label>
        <label>
          {text[RSC.MODELS_ENDPOINT_TYPE_LABEL]}
          <select
            value={draft.type}
            onChange={(event) =>
              setDraft({ ...draft, type: event.target.value as ModelEndpointType })
            }
          >
            {endpointTypes.map(([value, key]) => (
              <option key={value} value={value}>
                {text[key]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="models-form-actions">
        <Button type="submit" disabled={busy}>
          <Save aria-hidden="true" />
          {text[RSC.MODELS_ENDPOINT_SAVE_BUTTON]}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          <X aria-hidden="true" />
          {text[RSC.MODELS_ENDPOINT_CANCEL_BUTTON]}
        </Button>
      </div>
      {error && <p role="alert" className="error-text">{error}</p>}
    </form>
  );
}

function ModelDefinitionEditor({
  endpoint,
  item,
  busy,
  text,
  onSave,
}: {
  endpoint: ModelEndpoint;
  item: ModelDefinition;
  busy: boolean;
  text: Record<string, string>;
  onSave: ModelDefinitionSave;
}) {
  const [draft, setDraft] = useState<UpdateModelDefinitionRequest>({
    identifier: item.identifier,
    contextSize: item.contextSize,
    temperature: item.temperature,
    minP: item.minP,
    topP: item.topP,
    topK: item.topK,
    repeatPenalty: item.repeatPenalty,
    reasoning: item.reasoning,
    supportsText: item.supportsText,
    supportsImage: item.supportsImage,
    supportsSound: item.supportsSound,
    supportsVideo: item.supportsVideo,
  });

  return (
    <details className="models-definition" key={item.id}>
      <summary>
        <strong>{item.identifier}</strong>
        <span>{item.contextSize.toLocaleString()}</span>
      </summary>
      <form
        className="models-definition-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(endpoint.id, item.id, draft);
        }}
      >
        <label>
          {text[RSC.MODELS_MODEL_IDENTIFIER_LABEL]}
          <input
            required
            value={draft.identifier}
            onChange={(event) => setDraft({ ...draft, identifier: event.target.value })}
          />
        </label>
        <label>
          {text[RSC.MODELS_MODEL_CONTEXT_SIZE_LABEL]}
          <input
            required
            min={0}
            type="number"
            value={draft.contextSize}
            onChange={(event) => setDraft({ ...draft, contextSize: Number(event.target.value) })}
          />
        </label>
        <label>
          {text[RSC.MODELS_MODEL_TEMPERATURE_LABEL]}
          <input
            step="any"
            type="number"
            value={draft.temperature}
            onChange={(event) => setDraft({ ...draft, temperature: Number(event.target.value) })}
          />
        </label>
        <label>
          {text[RSC.MODELS_MODEL_MIN_P_LABEL]}
          <input
            min={0}
            max={1}
            step="any"
            type="number"
            value={draft.minP}
            onChange={(event) => setDraft({ ...draft, minP: Number(event.target.value) })}
          />
        </label>
        <label>
          {text[RSC.MODELS_MODEL_TOP_P_LABEL]}
          <input
            min={0}
            max={1}
            step="any"
            type="number"
            value={draft.topP}
            onChange={(event) => setDraft({ ...draft, topP: Number(event.target.value) })}
          />
        </label>
        <label>
          {text[RSC.MODELS_MODEL_TOP_K_LABEL]}
          <input
            min={0}
            step="1"
            type="number"
            value={draft.topK}
            onChange={(event) => setDraft({ ...draft, topK: Number(event.target.value) })}
          />
        </label>
        <label>
          {text[RSC.MODELS_MODEL_REPEAT_PENALTY_LABEL]}
          <input
            step="any"
            type="number"
            value={draft.repeatPenalty}
            onChange={(event) => setDraft({ ...draft, repeatPenalty: Number(event.target.value) })}
          />
        </label>
        <label className="models-check-row">
          <input
            type="checkbox"
            checked={draft.reasoning}
            onChange={(event) => setDraft({ ...draft, reasoning: event.target.checked })}
          />
          {text[RSC.MODELS_MODEL_REASONING_LABEL]}
        </label>
        <fieldset>
          <legend>{text[RSC.MODELS_MODEL_MODALITIES_LABEL]}</legend>
          <label className="models-check-row">
            <input type="checkbox" checked={draft.supportsText} onChange={(event) => setDraft({ ...draft, supportsText: event.target.checked })} />
            {text[RSC.MODELS_MODEL_TEXT_LABEL]}
          </label>
          <label className="models-check-row">
            <input type="checkbox" checked={draft.supportsImage} onChange={(event) => setDraft({ ...draft, supportsImage: event.target.checked })} />
            {text[RSC.MODELS_MODEL_IMAGE_LABEL]}
          </label>
          <label className="models-check-row">
            <input type="checkbox" checked={draft.supportsSound} onChange={(event) => setDraft({ ...draft, supportsSound: event.target.checked })} />
            {text[RSC.MODELS_MODEL_SOUND_LABEL]}
          </label>
          <label className="models-check-row">
            <input type="checkbox" checked={draft.supportsVideo} onChange={(event) => setDraft({ ...draft, supportsVideo: event.target.checked })} />
            {text[RSC.MODELS_MODEL_VIDEO_LABEL]}
          </label>
        </fieldset>
        <Button type="submit" disabled={busy}>
          <Save aria-hidden="true" />
          {text[RSC.MODELS_MODEL_SAVE_BUTTON]}
        </Button>
      </form>
    </details>
  );
}

export function ModelsScreen({ token, request }: { token: string; request: ModelsRequestApi }) {
  const text = texts(resolveLanguage());
  const model = useMemo(() => ensureModelsFeatureModel(token), [token]);
  const catalog = useModel(model.catalog).value;
  const selectedEndpointId = useModel(model.selection).value;
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function applyCatalog(path: string, options?: RequestInit): Promise<void> {
    const value = parseModelCatalogSnapshot(await request(path, options, token));
    if (!value) throw new Error(text[RSC.AUTH_ERROR_ALERT]);
    model.catalog.set(value);
  }

  async function load(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await applyCatalog("/api/models");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text[RSC.AUTH_ERROR_ALERT]);
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
  }, [model, token]);

  async function createEndpoint(draft: EndpointDraft): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await applyCatalog("/api/models", { method: "POST", body: JSON.stringify(draft) });
      setCreating(false);
      setStatus(text[RSC.MODELS_ENDPOINT_CREATED_STATUS]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text[RSC.AUTH_ERROR_ALERT]);
    } finally {
      setBusy(false);
    }
  }

  async function saveEndpoint(endpointId: string, draft: EndpointDraft): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await applyCatalog(`/api/models/${endpointId}`, { method: "PUT", body: JSON.stringify(draft) });
      setStatus(text[RSC.MODELS_ENDPOINT_UPDATED_STATUS]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text[RSC.AUTH_ERROR_ALERT]);
    } finally {
      setBusy(false);
    }
  }

  async function refreshEndpoint(endpointId: string): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await applyCatalog(`/api/models/${endpointId}/refresh`, { method: "POST" });
      setStatus(text[RSC.MODELS_ENDPOINT_REFRESH_STATUS]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text[RSC.AUTH_ERROR_ALERT]);
    } finally {
      setBusy(false);
    }
  }

  async function saveDefinition(endpointId: string, modelId: string, draft: UpdateModelDefinitionRequest): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await applyCatalog(`/api/models/${endpointId}/models/${modelId}`, { method: "PUT", body: JSON.stringify(draft) });
      setStatus(text[RSC.MODELS_MODEL_SAVED_STATUS]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text[RSC.AUTH_ERROR_ALERT]);
    } finally {
      setBusy(false);
    }
  }

  const selectedEndpoint = catalog.endpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? null;
  const selectedModels = selectedEndpoint
    ? catalog.models.filter((item) => item.endpointId === selectedEndpoint.id)
    : [];

  return (
    <section className="models-panel" aria-busy={!loaded}>
      {selectedEndpoint ? (
        <>
          <div className="page-heading models-detail-heading">
            <div>
              <div className="eyebrow">{text[RSC.MODELS_ENDPOINT_DETAIL_TEXT]}</div>
              <h1>{selectedEndpoint.name}</h1>
            </div>
            <Button variant="outline" onClick={() => model.selection.set(null)} disabled={busy}>
              <ArrowLeft aria-hidden="true" />
              {text[RSC.MODELS_BACK_BUTTON]}
            </Button>
          </div>
          <EndpointForm
            key={selectedEndpoint.id}
            endpoint={selectedEndpoint}
            busy={busy}
            error={error}
            text={text}
            onSave={(draft) => saveEndpoint(selectedEndpoint.id, draft)}
            onCancel={() => model.selection.set(null)}
          />
          <div className="models-list-heading">
            <div>
              <div className="eyebrow">{text[RSC.MODELS_ENDPOINT_MODELS_LABEL]}</div>
              <h2>{selectedEndpoint.name}</h2>
            </div>
            <Button type="button" variant="outline" onClick={() => refreshEndpoint(selectedEndpoint.id)} disabled={busy}>
              <RefreshCw aria-hidden="true" />
              {text[RSC.MODELS_ENDPOINT_REFRESH_BUTTON]}
            </Button>
          </div>
          {selectedModels.length === 0 ? (
            <p className="models-empty">{text[RSC.MODELS_ENDPOINT_MODELS_EMPTY_MESSAGE]}</p>
          ) : (
            <div className="models-definitions" aria-label={text[RSC.MODELS_ENDPOINT_MODELS_LABEL]}>
              {selectedModels.map((item) => (
                <ModelDefinitionEditor
                  key={item.id}
                  endpoint={selectedEndpoint}
                  item={item}
                  busy={busy}
                  text={text}
                  onSave={saveDefinition}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <div className="eyebrow">{text[RSC.ADMIN_BADGE_TEXT]}</div>
              <h1>{text[RSC.MODELS_TITLE_TEXT]}</h1>
              <p>{text[RSC.MODELS_SUBTITLE_TEXT]}</p>
            </div>
            <Button type="button" onClick={() => setCreating(true)} disabled={busy}>
              <Plus aria-hidden="true" />
              {text[RSC.MODELS_ADD_ENDPOINT_BUTTON]}
            </Button>
          </div>
          {creating && (
            <div className="models-dialog-backdrop" role="presentation">
              <section className="models-dialog" role="dialog" aria-modal="true" aria-label={text[RSC.MODELS_ADD_ENDPOINT_BUTTON]}>
                <div className="models-dialog-heading">
                  <h2>{text[RSC.MODELS_ADD_ENDPOINT_BUTTON]}</h2>
                </div>
                <EndpointForm
                  busy={busy}
                  error={error}
                  text={text}
                  onSave={createEndpoint}
                  onCancel={() => setCreating(false)}
                />
              </section>
            </div>
          )}
          {error && !creating && <p role="alert" className="error-text">{error}</p>}
          {status && <p role="status" className="models-status">{status}</p>}
          {!loaded ? (
            <p role="status" className="models-empty">{text[RSC.MODELS_LOADING_STATUS]}</p>
          ) : catalog.endpoints.length === 0 ? (
            <p className="models-empty">{text[RSC.MODELS_EMPTY_MESSAGE]}</p>
          ) : (
            <div className="models-endpoint-grid" aria-label={text[RSC.MODELS_TITLE_TEXT]}>
              {catalog.endpoints.map((endpoint) => {
                const endpointModels = catalog.models.filter((item) => item.endpointId === endpoint.id);
                return (
                  <button
                    className="models-endpoint-card"
                    key={endpoint.id}
                    onClick={() => model.selection.set(endpoint.id)}
                    type="button"
                    aria-label={endpoint.name}
                  >
                    <span className="models-endpoint-card-heading">
                      <Boxes aria-hidden="true" />
                      <strong>{endpoint.name}</strong>
                    </span>
                    <span className="models-endpoint-type">{providerLabel(endpoint.type, text)}</span>
                    <span className="models-endpoint-url">{endpoint.url}</span>
                    <span className="models-endpoint-header">
                      {endpoint.headerName ? (
                        <>
                          <span>{endpoint.headerName}</span>
                          <span>{text[RSC.MODELS_ENDPOINT_HEADER_CONFIGURED_TEXT]}</span>
                        </>
                      ) : text[RSC.MODELS_ENDPOINT_HEADER_NONE_TEXT]}
                    </span>
                    <span className="models-card-divider" aria-hidden="true" />
                    <span className="models-card-list">
                      {endpointModels.map((item) => (
                        <span className="models-card-model" key={item.id}>
                          <span>{item.identifier}</span>
                          <b>{item.contextSize.toLocaleString()}</b>
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      {selectedEndpoint && status && <p role="status" className="models-status">{status}</p>}
    </section>
  );
}
